import consola from "consola"

import type { CIFStreamEvent, CIFStreamEnd } from "~/cif/types"

/**
 * OpenAI streaming response chunk
 */
export interface OpenAIStreamChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<{
    index: number
    delta: OpenAIDelta
    logprobs?: null
    finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export interface OpenAIDelta {
  role?: "assistant"
  content?: string | null
  tool_calls?: Array<{
    index?: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

/**
 * Convert CIF streaming events to OpenAI SSE format
 */
export function cifEventToOpenAISSE(
  event: CIFStreamEvent,
  state: OpenAIStreamState,
): OpenAIStreamChunk | null {
  consola.debug(`[OpenAI Stream Serialization] Processing ${event.type} event`)

  switch (event.type) {
    case "stream_start": {
      consola.debug(
        `[OpenAI Stream Serialization] Starting stream for model: ${event.model}, id: ${event.id}`,
      )
      state.streamId = event.id
      state.model = event.model
      state.created = Math.floor(Date.now() / 1000)
      state.toolCallIndex = 0

      return {
        id: event.id,
        object: "chat.completion.chunk",
        created: state.created,
        model: event.model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant" },
            logprobs: null,
            finish_reason: null,
          },
        ],
      }
    }

    case "content_delta": {
      const { delta, contentBlock } = event

      // Handle new content blocks
      if (contentBlock) {
        switch (contentBlock.type) {
          case "tool_call": {
            // Start a new tool call
            const toolCallDelta: OpenAIDelta = {
              tool_calls: [
                {
                  index: state.toolCallIndex,
                  id: contentBlock.toolCallId,
                  type: "function",
                  function: {
                    name: contentBlock.toolName,
                    arguments: "",
                  },
                },
              ],
            }
            state.toolCallIndex++

            return {
              id: state.streamId,
              object: "chat.completion.chunk",
              created: state.created,
              model: state.model,
              choices: [
                {
                  index: 0,
                  delta: toolCallDelta,
                  logprobs: null,
                  finish_reason: null,
                },
              ],
            }
          }
        }
      }

      // Handle delta updates
      switch (delta.type) {
        case "text_delta": {
          return {
            id: state.streamId,
            object: "chat.completion.chunk",
            created: state.created,
            model: state.model,
            choices: [
              {
                index: 0,
                delta: { content: delta.text },
                logprobs: null,
                finish_reason: null,
              },
            ],
          }
        }

        case "thinking_delta": {
          // OpenAI doesn't have native thinking blocks, include as text
          return {
            id: state.streamId,
            object: "chat.completion.chunk",
            created: state.created,
            model: state.model,
            choices: [
              {
                index: 0,
                delta: { content: delta.thinking },
                logprobs: null,
                finish_reason: null,
              },
            ],
          }
        }

        case "tool_arguments_delta": {
          // Update the latest tool call arguments
          const toolCallDelta: OpenAIDelta = {
            tool_calls: [
              {
                index: state.toolCallIndex - 1, // Most recent tool call
                function: {
                  arguments: delta.partialJson,
                },
              },
            ],
          }

          return {
            id: state.streamId,
            object: "chat.completion.chunk",
            created: state.created,
            model: state.model,
            choices: [
              {
                index: 0,
                delta: toolCallDelta,
                logprobs: null,
                finish_reason: null,
              },
            ],
          }
        }

        default: {
          return null
        }
      }
    }

    case "stream_end": {
      return {
        id: state.streamId,
        object: "chat.completion.chunk",
        created: state.created,
        model: state.model,
        choices: [
          {
            index: 0,
            delta: {},
            logprobs: null,
            finish_reason: convertFinishReason(event.stopReason),
          },
        ],
        usage:
          event.usage ?
            {
              prompt_tokens: event.usage.inputTokens,
              completion_tokens: event.usage.outputTokens,
              total_tokens: event.usage.inputTokens + event.usage.outputTokens,
            }
          : undefined,
      }
    }

    default: {
      return null
    }
  }
}

export interface OpenAIStreamState {
  streamId: string
  model: string
  created: number
  toolCallIndex: number
}

export function createOpenAIStreamState(): OpenAIStreamState {
  return {
    streamId: "",
    model: "",
    created: 0,
    toolCallIndex: 0,
  }
}

function convertFinishReason(
  stopReason: CIFStreamEnd["stopReason"],
): OpenAIStreamChunk["choices"][0]["finish_reason"] {
  switch (stopReason) {
    case "end_turn": {
      return "stop"
    }
    case "max_tokens": {
      return "length"
    }
    case "tool_use": {
      return "tool_calls"
    }
    case "stop_sequence": {
      return "stop"
    }
    case "content_filter": {
      return "content_filter"
    }
    case "error": {
      return "stop"
    }
    default: {
      return "stop"
    }
  }
}
