import type { CIFStreamEvent } from "~/cif/types"
import type {
  ResponsesEvent,
  ResponseCreatedEvent,
  OutputItemAddedEvent,
  ContentBlockAddedEvent,
  OutputTextDeltaEvent,
  OutputTextDoneEvent,
  OutputItemDoneEvent,
  ResponseCompletedEvent,
} from "~/routes/responses/types"

/**
 * Convert CIF streaming events to Responses API SSE format
 */
export function* cifEventToResponsesSSE(
  event: CIFStreamEvent,
  state: ResponsesStreamState,
): Generator<ResponsesEvent> {
  switch (event.type) {
    case "stream_start": {
      state.responseId = event.id
      state.model = event.model
      state.currentItemId = `${event.id}-message`
      state.currentContentText = ""
      state.messageItemAdded = false

      const responseCreated: ResponseCreatedEvent = {
        type: "response.created",
        response: {
          id: event.id,
          object: "realtime.response",
          model: event.model,
          output: [],
          created_at: Math.floor(Date.now() / 1000),
        },
      }
      yield responseCreated
      break
    }

    case "content_delta": {
      const { delta, contentBlock } = event

      // Handle new content blocks
      if (contentBlock) {
        switch (contentBlock.type) {
          case "text":
          case "thinking": {
            if (!state.messageItemAdded) {
              // Add message output item
              const itemAdded: OutputItemAddedEvent = {
                type: "response.output_item.added",
                item: {
                  type: "message",
                  id: state.currentItemId,
                  role: "assistant",
                  content: [],
                },
              }
              yield itemAdded
              state.messageItemAdded = true

              // Add content block
              const contentBlockAdded: ContentBlockAddedEvent = {
                type: "response.content_block.added",
                content_block: {
                  type: "output_text",
                  text: "",
                },
              }
              yield contentBlockAdded
            }
            break
          }

          case "tool_call": {
            // Tool calls become separate function_call items
            const toolItemId = `${state.responseId}-tool-${contentBlock.toolCallId}`
            const toolItemAdded: OutputItemAddedEvent = {
              type: "response.output_item.added",
              item: {
                type: "function_call",
                id: toolItemId,
                role: "assistant",
                name: contentBlock.toolName,
                arguments: "",
              },
            }
            yield toolItemAdded
            state.currentToolItemId = toolItemId
            break
          }

          default: {
            // Skip unsupported content types
            break
          }
        }
      }

      // Handle delta updates
      switch (delta.type) {
        case "text_delta": {
          state.currentContentText += delta.text
          const textDelta: OutputTextDeltaEvent = {
            type: "response.output_text.delta",
            delta: delta.text,
          }
          yield textDelta
          break
        }

        case "thinking_delta": {
          // Include thinking as regular text in Responses API
          state.currentContentText += delta.thinking
          const textDelta: OutputTextDeltaEvent = {
            type: "response.output_text.delta",
            delta: delta.thinking,
          }
          yield textDelta
          break
        }

        case "tool_arguments_delta": {
          // Update tool call arguments - Responses API doesn't have streaming args
          // We'll just accumulate and send in the done event
          break
        }

        default: {
          break
        }
      }
      break
    }

    case "content_block_stop": {
      if (state.messageItemAdded && state.currentContentText) {
        const textDone: OutputTextDoneEvent = {
          type: "response.output_text.done",
          text: state.currentContentText,
        }
        yield textDone

        const itemDone: OutputItemDoneEvent = {
          type: "response.output_item.done",
          item: {
            type: "message",
            id: state.currentItemId,
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: state.currentContentText,
              },
            ],
          },
        }
        yield itemDone
      }
      break
    }

    case "stream_end": {
      // Finalize any remaining content
      if (state.messageItemAdded && state.currentContentText) {
        const textDone: OutputTextDoneEvent = {
          type: "response.output_text.done",
          text: state.currentContentText,
        }
        yield textDone

        const itemDone: OutputItemDoneEvent = {
          type: "response.output_item.done",
          item: {
            type: "message",
            id: state.currentItemId,
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: state.currentContentText,
              },
            ],
          },
        }
        yield itemDone
      }

      // Send final response completed event
      const responseCompleted: ResponseCompletedEvent = {
        type: "response.completed",
        response: {
          id: state.responseId,
          object: "realtime.response",
          model: state.model,
          output: [], // Will be filled by the accumulated items
          usage:
            event.usage ?
              {
                input_tokens: event.usage.inputTokens,
                output_tokens: event.usage.outputTokens,
              }
            : undefined,
          created_at: Math.floor(Date.now() / 1000),
        },
      }
      yield responseCompleted
      break
    }

    default: {
      break
    }
  }
}

export interface ResponsesStreamState {
  responseId: string
  model: string
  currentItemId: string
  currentToolItemId?: string
  currentContentText: string
  messageItemAdded: boolean
}

export function createResponsesStreamState(): ResponsesStreamState {
  return {
    responseId: "",
    model: "",
    currentItemId: "",
    currentContentText: "",
    messageItemAdded: false,
  }
}
