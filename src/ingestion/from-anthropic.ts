import consola from "consola"

import type {
  CanonicalRequest,
  CIFAssistantMessage,
  CIFContentPart,
  CIFMessage,
  CIFTool,
  CIFToolChoice,
  CIFUserMessage,
} from "~/cif/types"
import type {
  AnthropicAssistantContentBlock,
  AnthropicAssistantMessage,
  AnthropicMessage,
  AnthropicMessagesPayload,
  AnthropicTextBlock,
  AnthropicTool,
  AnthropicUserContentBlock,
  AnthropicUserMessage,
} from "~/routes/messages/anthropic-types"

/**
 * Convert Anthropic Messages API payload to CanonicalRequest
 */
export function parseAnthropicMessages(
  payload: AnthropicMessagesPayload,
): CanonicalRequest {
  consola.debug(
    `[Anthropic Ingestion] Parsing Anthropic payload for model: ${payload.model}`,
  )
  consola.debug(
    `[Anthropic Ingestion] Payload contains ${payload.messages.length} messages, stream: ${payload.stream ?? false}`,
  )

  const systemPrompt = translateSystemPrompt(payload.system)
  const messages = translateAnthropicMessages(payload.messages)
  const tools = translateAnthropicTools(payload.tools)

  if (systemPrompt) {
    consola.debug(
      `[Anthropic Ingestion] Extracted system prompt: ${systemPrompt.length} chars`,
    )
  }
  consola.debug(
    `[Anthropic Ingestion] Converted ${messages.length} messages to CIF format`,
  )
  if (tools) {
    consola.debug(
      `[Anthropic Ingestion] Converted ${tools.length} tools to CIF format`,
    )
  }
  if (payload.thinking?.budget_tokens) {
    consola.debug(
      `[Anthropic Ingestion] Thinking budget tokens: ${payload.thinking.budget_tokens}`,
    )
  }

  return {
    model: payload.model, // Keep original model name - adapters handle remapping
    systemPrompt,
    messages,
    tools,
    toolChoice: translateAnthropicToolChoice(payload.tool_choice),
    temperature: payload.temperature ?? undefined,
    topP: payload.top_p ?? undefined,
    maxTokens: payload.max_tokens,
    stop: payload.stop_sequences,
    stream: payload.stream ?? false,
    userId: payload.metadata?.user_id,
    extensions: {
      thinkingBudgetTokens: payload.thinking?.budget_tokens,
    },
  }
}

function translateSystemPrompt(
  system: string | Array<AnthropicTextBlock> | undefined,
): string | undefined {
  if (!system) {
    return undefined
  }

  if (typeof system === "string") {
    consola.debug(
      `[Anthropic Ingestion] System prompt is string: ${system.length} chars`,
    )
    return system
  }

  consola.debug(
    `[Anthropic Ingestion] System prompt has ${system.length} text blocks`,
  )
  // Join multiple system blocks with double newline
  return system.map((block) => block.text).join("\n\n")
}

function translateAnthropicMessages(
  anthropicMessages: Array<AnthropicMessage>,
): Array<CIFMessage> {
  consola.debug(
    `[Anthropic Ingestion] Processing ${anthropicMessages.length} Anthropic messages`,
  )

  const cifMessages = anthropicMessages.map((message) =>
    message.role === "user" ?
      translateUserMessage(message)
    : translateAssistantMessage(message),
  )

  // Log message type distribution
  const roleCount = cifMessages.reduce<Record<string, number>>((acc, msg) => {
    acc[msg.role] = (acc[msg.role] || 0) + 1
    return acc
  }, {})
  consola.debug(`[Anthropic Ingestion] Message distribution:`, roleCount)

  return cifMessages
}

function translateUserMessage(message: AnthropicUserMessage): CIFUserMessage {
  if (typeof message.content === "string") {
    return {
      role: "user",
      content: [{ type: "text", text: message.content }],
    }
  }

  return {
    role: "user",
    content: message.content.map(translateUserContentBlock),
  }
}

function translateUserContentBlock(
  block: AnthropicUserContentBlock,
): CIFContentPart {
  switch (block.type) {
    case "text": {
      return { type: "text", text: block.text }
    }
    case "image": {
      return {
        type: "image",
        mediaType: block.source.media_type,
        data: block.source.data,
      }
    }
    case "tool_result": {
      return {
        type: "tool_result",
        toolCallId: block.tool_use_id,
        toolName: "", // Will be filled in by provider adapter if needed
        content: normalizeToolResultContent(block.content),
        isError: block.is_error,
      }
    }
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = block
      throw new Error(
        `Unknown user content block type: ${JSON.stringify(_exhaustive)}`,
      )
    }
  }
}

function normalizeToolResultContent(
  content: string | Array<AnthropicTextBlock>,
): string {
  if (typeof content === "string") {
    return content
  }

  return content
    .map((block) => block.text)
    .filter((text) => text.length > 0)
    .join("\n\n")
}

function translateAssistantMessage(
  message: AnthropicAssistantMessage,
): CIFAssistantMessage {
  if (typeof message.content === "string") {
    return {
      role: "assistant",
      content: [{ type: "text", text: message.content }],
    }
  }

  return {
    role: "assistant",
    content: message.content.map(translateAssistantContentBlock),
  }
}

function translateAssistantContentBlock(
  block: AnthropicAssistantContentBlock,
): CIFContentPart {
  switch (block.type) {
    case "text": {
      return { type: "text", text: block.text }
    }
    case "thinking": {
      return {
        type: "thinking",
        thinking: block.thinking,
      }
    }
    case "tool_use": {
      return {
        type: "tool_call",
        toolCallId: block.id,
        toolName: block.name,
        toolArguments: block.input,
      }
    }
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = block
      throw new Error(
        `Unknown assistant content block type: ${JSON.stringify(_exhaustive)}`,
      )
    }
  }
}

function translateAnthropicTools(
  anthropicTools: Array<AnthropicTool> | undefined,
): Array<CIFTool> | undefined {
  if (!anthropicTools) {
    return undefined
  }

  return anthropicTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersSchema: normalizeAnthropicToolInputSchema(tool.input_schema),
  }))
}

function translateAnthropicToolChoice(
  anthropicToolChoice: AnthropicMessagesPayload["tool_choice"],
): CIFToolChoice | undefined {
  if (!anthropicToolChoice) {
    return undefined
  }

  switch (anthropicToolChoice.type) {
    case "auto": {
      return "auto"
    }
    case "any": {
      return "required"
    }
    case "tool": {
      if (anthropicToolChoice.name) {
        return {
          type: "function",
          functionName: anthropicToolChoice.name,
        }
      }
      return undefined
    }
    case "none": {
      return "none"
    }
    default: {
      return undefined
    }
  }
}

// ─────────────────────────────────────────────────────────
// JSON Schema normalization (copied from non-stream-translation.ts)
// ─────────────────────────────────────────────────────────

function normalizeAnthropicToolInputSchema(
  inputSchema: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = normalizeJsonSchema(inputSchema)

  if (!looksLikeJsonSchema(normalized)) {
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(normalized).map(([key, value]) => [
          key,
          normalizeJsonSchema(value),
        ]),
      ),
    }
  }

  return normalized
}

function normalizeJsonSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  const schema = { ...(value as Record<string, unknown>) }
  const nullable = schema.nullable === true
  delete schema.nullable

  // Remove banned fields that might cause issues with providers
  const banned = new Set([
    "$schema",
    "$id",
    "patternProperties",
    "prefill",
    "enumTitles",
    "deprecated",
    "propertyNames",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "const",
  ])

  for (const bannedField of banned) {
    delete schema[bannedField]
  }

  if (
    schema.properties
    && typeof schema.properties === "object"
    && !Array.isArray(schema.properties)
  ) {
    schema.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, unknown>).map(
        ([key, child]) => [key, normalizeJsonSchema(child)],
      ),
    )
  }

  if (schema.items && typeof schema.items === "object") {
    schema.items =
      Array.isArray(schema.items) ?
        schema.items.map((item) => normalizeJsonSchema(item))
      : normalizeJsonSchema(schema.items)
  }

  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const branch = schema[key]
    if (Array.isArray(branch)) {
      schema[key] = branch.map((item) => normalizeJsonSchema(item))
    }
  }

  if (
    schema.additionalProperties
    && typeof schema.additionalProperties === "object"
  ) {
    schema.additionalProperties = normalizeJsonSchema(
      schema.additionalProperties,
    )
  }

  if (!schema.type) {
    if (
      "properties" in schema
      || "required" in schema
      || "additionalProperties" in schema
    ) {
      schema.type = "object"
    } else if ("items" in schema) {
      schema.type = "array"
    }
  }

  if (nullable) {
    schema.type =
      typeof schema.type === "string" ? [schema.type, "null"]
      : Array.isArray(schema.type) ? [...new Set([...schema.type, "null"])]
      : ["null"]
  }

  return schema
}

function looksLikeJsonSchema(schema: Record<string, unknown>): boolean {
  const schemaKeys = new Set([
    "$defs",
    "$id",
    "$ref",
    "$schema",
    "additionalProperties",
    "allOf",
    "anyOf",
    "const",
    "default",
    "description",
    "enum",
    "examples",
    "format",
    "items",
    "maxItems",
    "maxLength",
    "maximum",
    "minItems",
    "minLength",
    "minimum",
    "multipleOf",
    "not",
    "oneOf",
    "pattern",
    "properties",
    "required",
    "title",
    "type",
  ])

  return Object.keys(schema).some((key) => schemaKeys.has(key))
}
