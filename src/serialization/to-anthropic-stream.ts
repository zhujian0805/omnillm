import type { CIFStreamEvent, CIFStreamEnd } from "~/cif/types"
import type {
  AnthropicStreamEventData,
  AnthropicMessageStartEvent,
  AnthropicContentBlockStartEvent,
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStopEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessageStopEvent,
} from "~/routes/messages/anthropic-types"

/**
 * Convert CIF streaming events to Anthropic SSE format
 */
export function* cifEventToAnthropicSSE(
  event: CIFStreamEvent,
  state: AnthropicStreamState,
): Generator<AnthropicStreamEventData> {
  switch (event.type) {
    case "stream_start": {
      const messageStart: AnthropicMessageStartEvent = {
        type: "message_start",
        message: {
          id: event.id,
          type: "message",
          role: "assistant",
          model: event.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      }
      state.messageStartSent = true
      state.nextContentBlockIndex = 0
      state.contentBlockOpen = false
      state.currentBlockProviderIndex = null
      state.currentBlockAnthropicIndex = null
      state.currentBlockType = null
      yield messageStart
      break
    }

    case "content_delta": {
      const { delta, contentBlock } = event

      if (contentBlock) {
        const nextBlockType = getBlockType(contentBlock)
        if (!nextBlockType) {
          return
        }

        const needsNewBlock =
          !state.contentBlockOpen
          || state.currentBlockProviderIndex !== event.index
          || state.currentBlockType !== nextBlockType

        if (needsNewBlock) {
          if (
            state.contentBlockOpen
            && state.currentBlockAnthropicIndex !== null
          ) {
            const stopEvent: AnthropicContentBlockStopEvent = {
              type: "content_block_stop",
              index: state.currentBlockAnthropicIndex,
            }
            yield stopEvent
          }

          const anthropicIndex = state.nextContentBlockIndex++
          const startEvent = createContentBlockStartEvent(
            contentBlock,
            anthropicIndex,
          )
          if (!startEvent) {
            return
          }

          yield startEvent
          state.contentBlockOpen = true
          state.currentBlockProviderIndex = event.index
          state.currentBlockAnthropicIndex = anthropicIndex
          state.currentBlockType = nextBlockType
        }
      }

      if (
        !state.contentBlockOpen
        || state.currentBlockAnthropicIndex === null
      ) {
        return
      }

      // Send delta event
      let deltaEvent: AnthropicContentBlockDeltaEvent

      switch (delta.type) {
        case "text_delta": {
          deltaEvent = {
            type: "content_block_delta",
            index: state.currentBlockAnthropicIndex,
            delta: { type: "text_delta", text: delta.text },
          }
          break
        }
        case "thinking_delta": {
          deltaEvent = {
            type: "content_block_delta",
            index: state.currentBlockAnthropicIndex,
            delta: { type: "thinking_delta", thinking: delta.thinking },
          }
          break
        }
        case "tool_arguments_delta": {
          deltaEvent = {
            type: "content_block_delta",
            index: state.currentBlockAnthropicIndex,
            delta: {
              type: "input_json_delta",
              partial_json: delta.partialJson,
            },
          }
          break
        }
        default: {
          return
        }
      }

      yield deltaEvent
      break
    }

    case "content_block_stop": {
      if (state.contentBlockOpen && state.currentBlockAnthropicIndex !== null) {
        const stopEvent: AnthropicContentBlockStopEvent = {
          type: "content_block_stop",
          index: state.currentBlockAnthropicIndex,
        }
        yield stopEvent
        state.contentBlockOpen = false
        state.currentBlockProviderIndex = null
        state.currentBlockAnthropicIndex = null
        state.currentBlockType = null
      }
      break
    }

    case "stream_end": {
      // Close any open content block
      if (state.contentBlockOpen && state.currentBlockAnthropicIndex !== null) {
        yield {
          type: "content_block_stop",
          index: state.currentBlockAnthropicIndex,
        }
        state.contentBlockOpen = false
        state.currentBlockProviderIndex = null
        state.currentBlockAnthropicIndex = null
        state.currentBlockType = null
      }

      // Send message delta with stop reason
      const messageDelta: AnthropicMessageDeltaEvent = {
        type: "message_delta",
        delta: {
          stop_reason: convertStopReason(event.stopReason),
          stop_sequence: event.stopSequence ?? null,
        },
        usage:
          event.usage ?
            {
              output_tokens: event.usage.outputTokens,
              cache_creation_input_tokens: event.usage.cacheWriteInputTokens,
              cache_read_input_tokens: event.usage.cacheReadInputTokens,
            }
          : undefined,
      }
      yield messageDelta

      // Send final message stop
      const messageStop: AnthropicMessageStopEvent = {
        type: "message_stop",
      }
      yield messageStop
      break
    }
  }
}

export interface AnthropicStreamState {
  messageStartSent: boolean
  nextContentBlockIndex: number
  contentBlockOpen: boolean
  currentBlockProviderIndex: number | null
  currentBlockAnthropicIndex: number | null
  currentBlockType: "text" | "thinking" | "tool_call" | null
}

export function createAnthropicStreamState(): AnthropicStreamState {
  return {
    messageStartSent: false,
    nextContentBlockIndex: 0,
    contentBlockOpen: false,
    currentBlockProviderIndex: null,
    currentBlockAnthropicIndex: null,
    currentBlockType: null,
  }
}

function getBlockType(
  contentBlock: NonNullable<
    Extract<CIFStreamEvent, { type: "content_delta" }>["contentBlock"]
  >,
): AnthropicStreamState["currentBlockType"] {
  switch (contentBlock.type) {
    case "text":
    case "thinking":
    case "tool_call": {
      return contentBlock.type
    }
    default: {
      return null
    }
  }
}

function createContentBlockStartEvent(
  contentBlock: NonNullable<
    Extract<CIFStreamEvent, { type: "content_delta" }>["contentBlock"]
  >,
  index: number,
): AnthropicContentBlockStartEvent | null {
  switch (contentBlock.type) {
    case "text": {
      return {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      }
    }
    case "thinking": {
      return {
        type: "content_block_start",
        index,
        content_block: { type: "thinking", thinking: "" },
      }
    }
    case "tool_call": {
      return {
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: contentBlock.toolCallId,
          name: contentBlock.toolName,
          input: {},
        },
      }
    }
    default: {
      return null
    }
  }
}

function convertStopReason(
  stopReason: CIFStreamEnd["stopReason"],
): AnthropicMessageDeltaEvent["delta"]["stop_reason"] {
  switch (stopReason) {
    case "end_turn": {
      return "end_turn"
    }
    case "max_tokens": {
      return "max_tokens"
    }
    case "tool_use": {
      return "tool_use"
    }
    case "stop_sequence": {
      return "stop_sequence"
    }
    case "content_filter":
    case "error": {
      return "end_turn"
    }
    default: {
      return "end_turn"
    }
  }
}
