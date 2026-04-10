import type { CanonicalResponse } from "~/cif/types"
import type { OutputItem } from "~/routes/responses/types"

/**
 * Convert CanonicalResponse to Responses API response
 */
export function serializeToResponses(
  response: CanonicalResponse,
): ResponsesResponse {
  const outputItems: Array<OutputItem> = []

  // Create a single message output item with all content
  const contentBlocks: Array<OutputContentBlock> = []

  for (const part of response.content) {
    switch (part.type) {
      case "text": {
        contentBlocks.push({
          type: "output_text",
          text: part.text,
        })
        break
      }
      case "thinking": {
        // Responses API doesn't have native thinking blocks, include as text
        contentBlocks.push({
          type: "output_text",
          text: `<thinking>\n${part.thinking}\n</thinking>`,
        })
        break
      }
      case "tool_call": {
        // Tool calls become separate function_call output items
        outputItems.push({
          type: "function_call",
          id: part.toolCallId,
          role: "assistant",
          name: part.toolName,
          arguments: JSON.stringify(part.toolArguments),
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

  // Add message item if we have content
  if (contentBlocks.length > 0) {
    outputItems.push({
      type: "message",
      id: `${response.id}-message`,
      role: "assistant",
      content: contentBlocks,
    })
  }

  return {
    id: response.id,
    object: "realtime.response",
    model: response.model,
    output: outputItems,
    usage:
      response.usage ?
        {
          input_tokens: response.usage.inputTokens,
          output_tokens: response.usage.outputTokens,
        }
      : undefined,
    created_at: Math.floor(Date.now() / 1000),
  }
}

interface ResponsesResponse {
  id: string
  object: "realtime.response"
  model: string
  output: Array<OutputItem>
  usage?: {
    input_tokens: number
    output_tokens: number
  }
  created_at?: number
}

interface OutputContentBlock {
  type: "output_text"
  text: string
}
