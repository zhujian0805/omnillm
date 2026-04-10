import type {
  CanonicalRequest,
  CIFContentPart,
  CIFMessage,
  CIFTool,
  CIFToolChoice,
} from "~/cif/types"
import type {
  InputContentBlock,
  InputItem,
  ResponsesPayload,
  ResponsesTool,
} from "~/routes/responses/types"

/**
 * Convert Responses API payload to CanonicalRequest
 */
export function parseResponsesPayload(
  payload: ResponsesPayload,
): CanonicalRequest {
  return {
    model: payload.model,
    systemPrompt: payload.instructions ?? undefined,
    messages: translateResponsesInput(payload.input),
    tools: translateResponsesTools(payload.tools),
    toolChoice: translateResponsesToolChoice(payload.tool_choice),
    temperature: payload.temperature ?? undefined,
    topP: payload.top_p ?? undefined,
    maxTokens: payload.max_output_tokens ?? undefined,
    stop: undefined, // Responses API doesn't support stop sequences
    stream: payload.stream ?? false,
  }
}

function translateResponsesInput(
  input: string | Array<InputItem>,
): Array<CIFMessage> {
  if (typeof input === "string") {
    return [
      {
        role: "user",
        content: [{ type: "text", text: input }],
      },
    ]
  }

  return input.flatMap((item) => translateInputItem(item))
}

function translateInputItem(item: InputItem): Array<CIFMessage> {
  switch (item.type) {
    case "message": {
      const content = translateInputContent(item.content)
      switch (item.role) {
        case "system": {
          return [
            {
              role: "system",
              content: extractInputText(item.content),
            },
          ]
        }
        case "user": {
          return [
            {
              role: "user",
              content,
            },
          ]
        }
        case "assistant": {
          return [
            {
              role: "assistant",
              content,
            },
          ]
        }
        default: {
          throw new Error("Unknown input item role")
        }
      }
    }
    case "function_call": {
      return [
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: requireToolCallId(item),
              toolName: item.name,
              toolArguments: parseToolArguments(item.arguments),
            },
          ],
        },
      ]
    }
    case "function_call_output": {
      return [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: item.call_id,
              toolName: item.name ?? "",
              content: item.output,
              isError: false,
            },
          ],
        },
      ]
    }
    default: {
      throw new Error("Unknown input item type")
    }
  }
}

function translateInputContent(
  content: string | Array<InputContentBlock>,
): Array<CIFContentPart> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }]
  }

  return content.map((block) => translateInputContentBlock(block))
}

function translateInputContentBlock(block: InputContentBlock): CIFContentPart {
  switch (block.type) {
    case "input_text":
    case "output_text": {
      return { type: "text", text: block.text }
    }
    default: {
      throw new Error("Unknown input content block type")
    }
  }
}

function extractInputText(content: string | Array<InputContentBlock>): string {
  return typeof content === "string" ? content : (
      content.map((block) => block.text).join("")
    )
}

function requireToolCallId(item: { call_id?: string; id?: string }): string {
  const toolCallId = item.call_id ?? item.id

  if (!toolCallId) {
    throw new Error("Responses function_call item missing call_id and id")
  }

  return toolCallId
}

function parseToolArguments(argumentsStr: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsStr)
    if (
      typeof parsed === "object"
      && parsed !== null
      && !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through to sentinel object.
  }

  return { _unparsable_arguments: argumentsStr }
}

function translateResponsesTools(
  responsesTools: Array<ResponsesTool> | undefined | null,
): Array<CIFTool> | undefined {
  if (!responsesTools || responsesTools.length === 0) {
    return undefined
  }

  // Filter out tools with empty names
  const validTools = responsesTools.filter(
    (tool) => tool.name.trim().length > 0,
  )

  if (validTools.length === 0) {
    return undefined
  }

  return validTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersSchema: tool.parameters,
  }))
}

function translateResponsesToolChoice(
  toolChoice: ResponsesPayload["tool_choice"],
): CIFToolChoice | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === "string") {
    switch (toolChoice) {
      case "none": {
        return "none"
      }
      case "auto": {
        return "auto"
      }
      case "required": {
        return "required"
      }
      default: {
        return undefined
      }
    }
  }

  if (typeof toolChoice === "object") {
    return {
      type: "function",
      functionName: toolChoice.function.name,
    }
  }

  return undefined
}
