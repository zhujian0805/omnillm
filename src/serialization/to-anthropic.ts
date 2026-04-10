import type { CanonicalResponse, CIFMessage } from "~/cif/types"
import type {
  AnthropicResponse,
  AnthropicAssistantContentBlock,
  AnthropicUserContentBlock,
  AnthropicMessage,
} from "~/routes/messages/anthropic-types"

/**
 * Convert CanonicalResponse to Anthropic Messages API response
 */
export function serializeToAnthropic(
  response: CanonicalResponse,
): AnthropicResponse {
  const content: Array<AnthropicAssistantContentBlock> = []

  for (const part of response.content) {
    switch (part.type) {
      case "text": {
        content.push({
          type: "text",
          text: part.text,
        })
        break
      }
      case "thinking": {
        content.push({
          type: "thinking",
          thinking: part.thinking,
        })
        break
      }
      case "tool_call": {
        content.push({
          type: "tool_use",
          id: part.toolCallId,
          name: part.toolName,
          input: part.toolArguments,
        })
        break
      }
      case "image":
      case "tool_result": {
        // These shouldn't appear in assistant responses
        break
      }
    }
  }

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: convertStopReason(response.stopReason),
    stop_sequence: response.stopSequence ?? null,
    usage:
      response.usage ?
        {
          input_tokens: response.usage.inputTokens,
          output_tokens: response.usage.outputTokens,
          cache_creation_input_tokens: response.usage.cacheWriteInputTokens,
          cache_read_input_tokens: response.usage.cacheReadInputTokens,
        }
      : {
          input_tokens: 0,
          output_tokens: 0,
        },
  }
}

/**
 * Convert CanonicalRequest messages to Anthropic Messages API format
 */
export function convertCIFMessagesToAnthropic(
  messages: Array<CIFMessage>,
): Array<AnthropicMessage> {
  const anthropicMessages: Array<AnthropicMessage> = []

  for (const message of messages) {
    if (message.role === "system") {
      // System messages are handled separately in Anthropic API
      continue
    }

    if (message.role === "user") {
      const content: Array<AnthropicUserContentBlock> = []

      for (const part of message.content) {
        switch (part.type) {
          case "text": {
            content.push({
              type: "text",
              text: part.text,
            })
            break
          }
          case "image": {
            if (part.data) {
              // Anthropic only supports base64 images, not URLs
              content.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: part.mediaType,
                  data: part.data,
                },
              })
            }
            break
          }
          case "tool_result": {
            content.push({
              type: "tool_result",
              tool_use_id: part.toolCallId,
              content: part.content,
              is_error: part.isError,
            })
            break
          }
          case "thinking":
          case "tool_call": {
            // These shouldn't appear in user messages in Anthropic format
            break
          }
        }
      }

      if (content.length > 0) {
        anthropicMessages.push({
          role: "user",
          content,
        })
      }
    } else {
      // Assistant message
      const content: Array<AnthropicAssistantContentBlock> = []

      for (const part of message.content) {
        switch (part.type) {
          case "text": {
            content.push({
              type: "text",
              text: part.text,
            })
            break
          }
          case "thinking": {
            content.push({
              type: "thinking",
              thinking: part.thinking,
            })
            break
          }
          case "tool_call": {
            content.push({
              type: "tool_use",
              id: part.toolCallId,
              name: part.toolName,
              input: part.toolArguments,
            })
            break
          }
          case "image":
          case "tool_result": {
            // These shouldn't appear in assistant messages
            break
          }
        }
      }

      if (content.length > 0) {
        anthropicMessages.push({
          role: "assistant",
          content,
        })
      }
    }
  }

  return anthropicMessages
}

function convertStopReason(
  stopReason: CanonicalResponse["stopReason"],
): AnthropicResponse["stop_reason"] {
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
