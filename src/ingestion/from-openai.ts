import consola from "consola"

import type {
  CanonicalRequest,
  CIFContentPart,
  CIFMessage,
  CIFTool,
  CIFToolChoice,
} from "~/cif/types"
import type {
  ChatCompletionsPayload,
  ContentPart,
  Message,
  Tool,
} from "~/services/copilot/create-chat-completions"

/**
 * Convert OpenAI Chat Completions payload to CanonicalRequest
 */
export function parseOpenAIChatCompletions(
  payload: ChatCompletionsPayload,
): CanonicalRequest {
  consola.debug(
    `[OpenAI Ingestion] Parsing OpenAI payload for model: ${payload.model}`,
  )
  consola.debug(
    `[OpenAI Ingestion] Payload contains ${payload.messages.length} messages, stream: ${payload.stream ?? false}`,
  )

  const systemPrompt = extractSystemPrompt(payload.messages)
  const messages = translateOpenAIMessages(payload.messages)
  const tools = translateOpenAITools(payload.tools ?? undefined)

  if (systemPrompt) {
    consola.debug(
      `[OpenAI Ingestion] Extracted system prompt: ${systemPrompt.length} chars`,
    )
  }
  consola.debug(
    `[OpenAI Ingestion] Converted ${messages.length} messages to CIF format`,
  )
  if (tools) {
    consola.debug(
      `[OpenAI Ingestion] Converted ${tools.length} tools to CIF format`,
    )
  }

  return {
    model: payload.model,
    systemPrompt,
    messages,
    tools,
    toolChoice: translateOpenAIToolChoice(payload.tool_choice),
    temperature: payload.temperature ?? undefined,
    topP: payload.top_p ?? undefined,
    maxTokens: payload.max_tokens ?? undefined,
    stop: normalizeStopSequences(payload.stop),
    stream: payload.stream ?? false,
    userId: payload.user ?? undefined,
  }
}

function extractSystemPrompt(messages: Array<Message>): string | undefined {
  const systemMessages = messages.filter((msg) => msg.role === "system")
  if (systemMessages.length === 0) {
    return undefined
  }

  consola.debug(
    `[OpenAI Ingestion] Found ${systemMessages.length} system messages`,
  )

  // Join multiple system messages with double newline
  return systemMessages
    .map((msg) =>
      typeof msg.content === "string" ? msg.content
      : Array.isArray(msg.content) ? extractTextFromContent(msg.content)
      : "",
    )
    .join("\n\n")
}

function translateOpenAIMessages(messages: Array<Message>): Array<CIFMessage> {
  // Filter out system messages (already handled in systemPrompt)
  const nonSystemMessages = messages.filter((msg) => msg.role !== "system")
  consola.debug(
    `[OpenAI Ingestion] Processing ${nonSystemMessages.length} non-system messages`,
  )

  const cifMessages = nonSystemMessages.map(translateOpenAIMessage)

  // Log message type distribution
  const roleCount = cifMessages.reduce<Record<string, number>>((acc, msg) => {
    acc[msg.role] = (acc[msg.role] || 0) + 1
    return acc
  }, {})
  consola.debug(`[OpenAI Ingestion] Message distribution:`, roleCount)

  return cifMessages
}

function translateOpenAIMessage(message: Message): CIFMessage {
  switch (message.role) {
    case "system": {
      // This shouldn't happen since we filter out system messages,
      // but handle it for type safety
      return {
        role: "user",
        content: [
          {
            type: "text",
            text: `[SYSTEM] ${typeof message.content === "string" ? message.content : ""}`,
          },
        ],
      }
    }
    case "user": {
      return {
        role: "user",
        content: translateMessageContent(message.content),
      }
    }
    case "assistant": {
      const content: Array<CIFContentPart> = []

      // Add text content if present
      if (message.content) {
        content.push(...translateMessageContent(message.content))
      }

      // Add tool calls if present
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          content.push({
            type: "tool_call",
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            toolArguments: parseToolArguments(toolCall.function.arguments),
          })
        }
      }

      return {
        role: "assistant",
        content,
      }
    }
    case "tool": {
      // Convert tool message to user message with tool_result content
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolCallId: message.tool_call_id || "",
            toolName: message.name || "",
            content: typeof message.content === "string" ? message.content : "",
            isError: false,
          },
        ],
      }
    }
    case "developer": {
      // Treat developer messages like user messages
      return {
        role: "user",
        content: translateMessageContent(message.content),
      }
    }
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = message.role
      throw new Error(`Unknown message role: ${_exhaustive}`)
    }
  }
}

function translateMessageContent(
  content: string | Array<ContentPart> | null,
): Array<CIFContentPart> {
  if (!content) {
    return []
  }

  if (typeof content === "string") {
    return [{ type: "text", text: content }]
  }

  return content.map(translateContentPart)
}

function translateContentPart(part: ContentPart): CIFContentPart {
  switch (part.type) {
    case "text": {
      return { type: "text", text: part.text }
    }
    case "image_url": {
      const url = part.image_url.url

      // Parse data URI if present
      if (url.startsWith("data:")) {
        const match = url.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          const [, mediaType, data] = match
          return {
            type: "image",
            mediaType: mediaType as any, // Trust the format for now
            data,
          }
        }
      }

      // Regular URL
      return {
        type: "image",
        mediaType: "image/jpeg", // Default, can't determine from URL
        url,
      }
    }
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = part
      throw new Error(
        `Unknown content part type: ${JSON.stringify(_exhaustive)}`,
      )
    }
  }
}

function extractTextFromContent(content: Array<ContentPart>): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
}

function parseToolArguments(argumentsStr: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsStr)
    consola.debug(
      `[OpenAI Ingestion] Successfully parsed tool arguments: ${Object.keys(parsed).length} keys`,
    )
    return parsed
  } catch (error) {
    consola.warn(
      `[OpenAI Ingestion] Failed to parse tool arguments: ${error}, treating as unparsable`,
    )
    // If parsing fails, return as-is wrapped in error context
    return { _unparsable_arguments: argumentsStr }
  }
}

function translateOpenAITools(
  openaiTools: Array<Tool> | undefined,
): Array<CIFTool> | undefined {
  if (!openaiTools) {
    return undefined
  }

  return openaiTools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parametersSchema: tool.function.parameters,
  }))
}

function translateOpenAIToolChoice(
  openaiToolChoice: ChatCompletionsPayload["tool_choice"],
): CIFToolChoice | undefined {
  if (!openaiToolChoice) {
    return undefined
  }

  if (typeof openaiToolChoice === "string") {
    switch (openaiToolChoice) {
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

  if (openaiToolChoice.type === "function") {
    return {
      type: "function",
      functionName: openaiToolChoice.function.name,
    }
  }

  return undefined
}

function normalizeStopSequences(
  stop: string | Array<string> | null | undefined,
): Array<string> | undefined {
  if (!stop) {
    return undefined
  }

  return Array.isArray(stop) ? stop : [stop]
}
