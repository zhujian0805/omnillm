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
  Message,
  Tool,
  ContentPart,
} from "~/services/copilot/create-chat-completions"

/**
 * Convert CanonicalRequest to OpenAI ChatCompletionsPayload
 * Used by passthrough providers (GitHub Copilot, Azure OpenAI, Alibaba)
 */
export function canonicalRequestToChatCompletionsPayload(
  request: CanonicalRequest,
): ChatCompletionsPayload {
  consola.debug(
    `[OpenAI Serialization] Converting canonical request for model: ${request.model}`,
  )

  const messages: Array<Message> = []

  // Add system message if present
  if (request.systemPrompt) {
    consola.debug(
      `[OpenAI Serialization] Adding system message: ${request.systemPrompt.length} chars`,
    )
    messages.push({
      role: "system",
      content: request.systemPrompt,
    })
  }

  // Convert CIF messages to OpenAI messages
  let totalOpenAIMessages = 0
  for (const cifMessage of request.messages) {
    const openAIMessages = convertCIFMessageToOpenAI(cifMessage)
    messages.push(...openAIMessages)
    totalOpenAIMessages += openAIMessages.length
  }

  consola.debug(
    `[OpenAI Serialization] Converted ${request.messages.length} CIF messages to ${totalOpenAIMessages} OpenAI messages`,
  )

  if (request.tools) {
    consola.debug(
      `[OpenAI Serialization] Converting ${request.tools.length} tools`,
    )
  }

  return {
    model: request.model,
    messages,
    temperature: request.temperature,
    top_p: request.topP,
    max_tokens: request.maxTokens,
    stop: request.stop,
    stream: request.stream,
    tools: convertCIFToolsToOpenAI(request.tools),
    tool_choice: convertCIFToolChoiceToOpenAI(request.toolChoice),
    user: request.userId,
  }
}

function convertCIFMessageToOpenAI(cifMessage: CIFMessage): Array<Message> {
  consola.debug(
    `[OpenAI Serialization] Converting ${cifMessage.role} message with ${cifMessage.content.length} content parts`,
  )

  switch (cifMessage.role) {
    case "system": {
      // This shouldn't happen since system is handled separately,
      // but handle for completeness
      return [
        {
          role: "system",
          content: cifMessage.content,
        },
      ]
    }
    case "user": {
      const { toolResults, otherContent } = separateToolResults(
        cifMessage.content,
      )

      const messages: Array<Message> = []

      // Tool results become separate tool messages in OpenAI format
      for (const toolResult of toolResults) {
        consola.debug(
          `[OpenAI Serialization] Converting tool result for call: ${toolResult.toolCallId}`,
        )
        messages.push({
          role: "tool",
          tool_call_id: toolResult.toolCallId,
          content: toolResult.content,
          name: toolResult.toolName || undefined,
        })
      }

      // Regular content becomes a user message
      messages.push({
        role: "user",
        content:
          otherContent.length > 0 ?
            convertContentPartsToOpenAI(otherContent)
          : "",
      })

      consola.debug(
        `[OpenAI Serialization] User message converted to ${messages.length} OpenAI messages (${toolResults.length} tool results)`,
      )
      return messages
    }
    case "assistant": {
      const { toolCalls, otherContent } = separateToolCalls(cifMessage.content)

      // Assistant message with both text and tool calls
      const message: Message = {
        role: "assistant",
        content:
          otherContent.length > 0 ?
            convertContentPartsToOpenAI(otherContent)
          : null,
      }

      if (toolCalls.length > 0) {
        consola.debug(
          `[OpenAI Serialization] Assistant message includes ${toolCalls.length} tool calls`,
        )
        message.tool_calls = toolCalls.map((toolCall) => ({
          id: toolCall.toolCallId,
          type: "function",
          function: {
            name: toolCall.toolName,
            arguments: JSON.stringify(toolCall.toolArguments),
          },
        }))
      }

      return [message]
    }
    default: {
      const _exhaustive: never = cifMessage
      throw new Error(
        `Unknown CIF message role: ${JSON.stringify(_exhaustive)}`,
      )
    }
  }
}

function separateToolResults(content: Array<CIFContentPart>) {
  const toolResults: Array<Extract<CIFContentPart, { type: "tool_result" }>> =
    []
  const otherContent: Array<CIFContentPart> = []

  for (const part of content) {
    if (part.type === "tool_result") {
      toolResults.push(part)
    } else {
      otherContent.push(part)
    }
  }

  return { toolResults, otherContent }
}

function separateToolCalls(content: Array<CIFContentPart>) {
  const toolCalls: Array<Extract<CIFContentPart, { type: "tool_call" }>> = []
  const otherContent: Array<CIFContentPart> = []

  for (const part of content) {
    if (part.type === "tool_call") {
      toolCalls.push(part)
    } else {
      otherContent.push(part)
    }
  }

  return { toolCalls, otherContent }
}

function convertContentPartsToOpenAI(
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
      .map((part) => (part.type === "text" ? part.text : part.thinking))
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
          return { type: "text", text: part.text }
        }
        case "thinking": {
          return { type: "text", text: part.thinking }
        }
        case "image": {
          const url =
            part.url
            || (part.data ? `data:${part.mediaType};base64,${part.data}` : "")
          return {
            type: "image_url",
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

function convertCIFToolsToOpenAI(
  cifTools: Array<CIFTool> | undefined,
): Array<Tool> | undefined {
  if (!cifTools || cifTools.length === 0) {
    return undefined
  }

  return cifTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
    },
  }))
}

function convertCIFToolChoiceToOpenAI(
  cifToolChoice: CIFToolChoice | undefined,
): ChatCompletionsPayload["tool_choice"] {
  if (!cifToolChoice) {
    return undefined
  }

  if (typeof cifToolChoice === "string") {
    return cifToolChoice
  }

  if (cifToolChoice.type === "function") {
    return {
      type: "function",
      function: { name: cifToolChoice.functionName },
    }
  }

  return undefined
}
