import type { CanonicalResponse, CIFContentPart } from "~/cif/types"
import type {
  ChatCompletionResponse,
  ContentPart,
  ToolCall,
} from "~/services/copilot/create-chat-completions"

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  tool_calls?: Array<ToolCall>
}

/**
 * Convert CanonicalResponse to OpenAI Chat Completions response
 */
export function serializeToOpenAI(
  response: CanonicalResponse,
): ChatCompletionResponse {
  const choice: ChoiceNonStreaming = {
    index: 0,
    message: createResponseMessage(response.content),
    logprobs: null,
    finish_reason: convertFinishReason(response.stopReason),
  }

  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [choice],
    usage:
      response.usage ?
        {
          prompt_tokens: response.usage.inputTokens,
          completion_tokens: response.usage.outputTokens,
          total_tokens:
            response.usage.inputTokens + response.usage.outputTokens,
          prompt_tokens_details:
            response.usage.cacheReadInputTokens ?
              {
                cached_tokens: response.usage.cacheReadInputTokens,
              }
            : undefined,
        }
      : undefined,
    system_fingerprint: undefined,
  }
}

function createResponseMessage(
  content: Array<CIFContentPart>,
): ResponseMessage {
  // Separate text content and tool calls
  const textParts: Array<string> = []
  const toolCalls: Array<ToolCall> = []

  for (const part of content) {
    switch (part.type) {
      case "text": {
        textParts.push(part.text)
        break
      }
      case "thinking": {
        // OpenAI doesn't have native thinking blocks, include as text
        textParts.push(`<thinking>\n${part.thinking}\n</thinking>`)
        break
      }
      case "tool_call": {
        toolCalls.push({
          id: part.toolCallId,
          type: "function",
          function: {
            name: part.toolName,
            arguments: JSON.stringify(part.toolArguments),
          },
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
    role: "assistant",
    content: textParts.length > 0 ? textParts.join("\n\n") : null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

/**
 * Convert CIF content parts to OpenAI content format
 * Used for user/assistant message conversion
 */
export function convertContentPartsToOpenAI(
  parts: Array<CIFContentPart>,
): string | Array<ContentPart> {
  // Check if we have any images
  const hasImages = parts.some((part) => part.type === "image")

  if (!hasImages) {
    // No images - return as plain string, joining text and thinking
    return parts
      .filter(
        (
          part,
        ): part is Extract<CIFContentPart, { type: "text" | "thinking" }> =>
          part.type === "text" || part.type === "thinking",
      )
      .map((part) =>
        part.type === "text" ?
          part.text
        : `<thinking>\n${part.thinking}\n</thinking>`,
      )
      .join("\n\n")
  }

  // Has images - return as content parts array
  return parts
    .filter(
      (
        part,
      ): part is Extract<
        CIFContentPart,
        { type: "text" | "thinking" | "image" }
      > =>
        part.type === "text"
        || part.type === "thinking"
        || part.type === "image",
    )
    .map((part) => {
      switch (part.type) {
        case "text": {
          return { type: "text" as const, text: part.text }
        }
        case "thinking": {
          return {
            type: "text" as const,
            text: `<thinking>\n${part.thinking}\n</thinking>`,
          }
        }
        case "image": {
          const url =
            part.url
            || (part.data ? `data:${part.mediaType};base64,${part.data}` : "")
          return {
            type: "image_url" as const,
            image_url: { url },
          }
        }
        default: {
          const _exhaustive: never = part
          throw new Error(
            `Unexpected content part: ${JSON.stringify(_exhaustive)}`,
          )
        }
      }
    })
}

function convertFinishReason(
  stopReason: CanonicalResponse["stopReason"],
): ChoiceNonStreaming["finish_reason"] {
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
