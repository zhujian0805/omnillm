import { state } from "~/lib/state"
import {
  type Model,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
  type ContentPart,
  type Message,
  type TextPart,
  type Tool,
  type ToolCall,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicAssistantContentBlock,
  type AnthropicAssistantMessage,
  type AnthropicMessage,
  type AnthropicMessagesPayload,
  type AnthropicResponse,
  type AnthropicTextBlock,
  type AnthropicThinkingBlock,
  type AnthropicTool,
  type AnthropicToolResultBlock,
  type AnthropicToolUseBlock,
  type AnthropicUserContentBlock,
  type AnthropicUserMessage,
} from "./anthropic-types"
import { mapOpenAIStopReasonToAnthropic } from "./utils"

// Payload translation

/** @deprecated Use parseAnthropicMessages() and serializeToOpenAI() instead for new code */
export function translateToOpenAI(
  payload: AnthropicMessagesPayload,
  providerOverrideId?: string,
): ChatCompletionsPayload {
  return {
    model: translateModelName(payload.model, providerOverrideId),
    messages: translateAnthropicMessagesToOpenAI(
      payload.messages,
      payload.system,
    ),
    max_tokens: payload.max_tokens,
    stop: payload.stop_sequences,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    user: payload.metadata?.user_id,
    tools: translateAnthropicToolsToOpenAI(payload.tools),
    tool_choice: translateAnthropicToolChoiceToOpenAI(payload.tool_choice),
  }
}

function translateModelName(
  model: string,
  providerOverrideId?: string,
): string {
  // @deprecated This function is deprecated. Use provider.adapter.remapModel() instead.
  // This is only kept for backward compatibility with the legacy translation path.
  const providerId = providerOverrideId ?? state.currentProvider?.id
  if (providerId === "antigravity") {
    return translateModelNameForAntigravity(model)
  }
  if (providerId === "alibaba") {
    return translateModelNameForAlibaba(model)
  }
  return translateModelNameForCopilot(model)
}

/** @deprecated Use AntigravityAdapter.remapModel() instead */
function translateModelNameForAntigravity(model: string): string {
  // Antigravity uses hyphen-separated IDs: claude-sonnet-4-6, claude-opus-4-6-thinking
  if (model.startsWith("claude-opus-4")) {
    return "claude-opus-4-6-thinking"
  }
  if (model.startsWith("claude-opus-")) {
    return "claude-opus-4-6-thinking"
  }
  if (model.startsWith("claude-sonnet-4")) {
    return "claude-sonnet-4-6"
  }
  if (model.startsWith("claude-haiku-4")) {
    return "claude-sonnet-4-6"
  }
  return model
}

/** @deprecated Use GitHubCopilotAdapter.remapModel() instead */
function translateModelNameForCopilot(model: string): string {
  // Translate Claude models to closest available version in Copilot API
  // Handle claude-opus variants
  if (model.startsWith("claude-opus-4.6")) {
    return "claude-opus-4.6"
  }
  if (model.startsWith("claude-opus-4-")) {
    return "claude-opus-4.6"
  }
  if (model.startsWith("claude-opus-")) {
    return "claude-opus-4.5"
  }

  // Handle claude-sonnet variants
  if (model.startsWith("claude-sonnet-4.6")) {
    return "claude-sonnet-4.6"
  }
  if (model.startsWith("claude-sonnet-4-")) {
    return "claude-sonnet-4.6"
  }
  if (model.startsWith("claude-sonnet-4.5")) {
    return "claude-sonnet-4.5"
  }
  if (model.startsWith("claude-sonnet-4")) {
    return "claude-sonnet-4"
  }

  // Handle claude-haiku variants
  if (model.startsWith("claude-haiku-4")) {
    return "claude-haiku-4.5"
  }

  return model
}

function getAvailableModelIds(): Array<string> {
  const models = state.models?.data ?? []
  const availableModelIds: Array<string> = []

  for (const candidate of models) {
    availableModelIds.push((candidate as Model).id)
  }

  return availableModelIds
}

function resolvePreferredModel(
  exactIds: Array<string>,
  patterns: Array<RegExp>,
): string | null {
  const availableModelIds = getAvailableModelIds()

  for (const exactId of exactIds) {
    if (availableModelIds.includes(exactId)) {
      return exactId
    }
  }

  for (const pattern of patterns) {
    const matchedModel = availableModelIds.find((candidate) =>
      pattern.test(candidate),
    )
    if (matchedModel) {
      return matchedModel
    }
  }

  return null
}

/** @deprecated Use AlibabaAdapter.remapModel() instead */
function translateModelNameForAlibaba(model: string): string {
  if (!model.startsWith("claude-")) {
    return model
  }

  const isHaiku = model.includes("haiku")
  const isOpus = model.includes("opus")
  const isSonnet = model.includes("sonnet")

  if (isHaiku) {
    return (
      resolvePreferredModel(
        [
          "qwen3-coder-flash",
          "qwen3.5-flash",
          "qwen-flash",
          "qwen-turbo-latest",
          "qwen-turbo",
          "glm-5",
        ],
        [
          /^qwen3-coder-flash(?:-|$)/,
          /^qwen3\.5-flash(?:-|$)/,
          /^qwen-flash(?:-|$)/,
          /^qwen-turbo(?:-|$)/,
          /^glm-5(?:-|$)/,
        ],
      ) ?? model
    )
  }

  if (isOpus) {
    return (
      resolvePreferredModel(
        [
          "qwen3-max",
          "qwen3-max-preview",
          "qwen-max-latest",
          "qwen-max",
          "glm-5",
        ],
        [/^qwen3-max(?:-|$)/, /^qwen-max(?:-|$)/, /^glm-5(?:-|$)/],
      ) ?? model
    )
  }

  if (isSonnet) {
    return (
      resolvePreferredModel(
        [
          "qwen3.6-plus",
          "qwen3-coder-plus",
          "qwen3-coder-next",
          "qwen3.5-plus",
          "qwen-plus-latest",
          "qwen-plus",
          "glm-5",
        ],
        [
          /^qwen3\.6-plus(?:-|$)/,
          /^qwen3-coder-plus(?:-|$)/,
          /^qwen3-coder-next(?:-|$)/,
          /^qwen3\.5-plus(?:-|$)/,
          /^qwen-plus(?:-|$)/,
          /^glm-5(?:-|$)/,
        ],
      ) ?? model
    )
  }

  return model
}

function translateAnthropicMessagesToOpenAI(
  anthropicMessages: Array<AnthropicMessage>,
  system: string | Array<AnthropicTextBlock> | undefined,
): Array<Message> {
  const systemMessages = handleSystemPrompt(system)

  const otherMessages = anthropicMessages.flatMap((message) =>
    message.role === "user" ?
      handleUserMessage(message)
    : handleAssistantMessage(message),
  )

  return [...systemMessages, ...otherMessages]
}

function handleSystemPrompt(
  system: string | Array<AnthropicTextBlock> | undefined,
): Array<Message> {
  if (!system) {
    return []
  }

  if (typeof system === "string") {
    return [{ role: "system", content: system }]
  } else {
    const systemText = system.map((block) => block.text).join("\n\n")
    return [{ role: "system", content: systemText }]
  }
}

function handleUserMessage(message: AnthropicUserMessage): Array<Message> {
  const newMessages: Array<Message> = []

  if (Array.isArray(message.content)) {
    const toolResultBlocks = message.content.filter(
      (block): block is AnthropicToolResultBlock =>
        block.type === "tool_result",
    )
    const otherBlocks = message.content.filter(
      (block) => block.type !== "tool_result",
    )

    // Tool results must come first to maintain protocol: tool_use -> tool_result -> user
    for (const block of toolResultBlocks) {
      newMessages.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: mapContent(block.content),
      })
    }

    if (otherBlocks.length > 0) {
      newMessages.push({
        role: "user",
        content: mapContent(otherBlocks),
      })
    }
  } else {
    newMessages.push({
      role: "user",
      content: mapContent(message.content),
    })
  }

  return newMessages
}

function handleAssistantMessage(
  message: AnthropicAssistantMessage,
): Array<Message> {
  if (!Array.isArray(message.content)) {
    return [
      {
        role: "assistant",
        content: mapContent(message.content),
      },
    ]
  }

  const toolUseBlocks = message.content.filter(
    (block): block is AnthropicToolUseBlock => block.type === "tool_use",
  )

  const textBlocks = message.content.filter(
    (block): block is AnthropicTextBlock => block.type === "text",
  )

  const thinkingBlocks = message.content.filter(
    (block): block is AnthropicThinkingBlock => block.type === "thinking",
  )

  // Combine text and thinking blocks, as OpenAI doesn't have separate thinking blocks
  const allTextContent = [
    ...textBlocks.map((b) => b.text),
    ...thinkingBlocks.map((b) => b.thinking),
  ].join("\n\n")

  return toolUseBlocks.length > 0 ?
      [
        {
          role: "assistant",
          content: allTextContent || null,
          tool_calls: toolUseBlocks.map((toolUse) => ({
            id: toolUse.id,
            type: "function",
            function: {
              name: toolUse.name,
              arguments: JSON.stringify(toolUse.input),
            },
          })),
        },
      ]
    : [
        {
          role: "assistant",
          content: mapContent(message.content),
        },
      ]
}

function mapContent(
  content:
    | string
    | Array<AnthropicUserContentBlock | AnthropicAssistantContentBlock>,
): string | Array<ContentPart> | null {
  if (typeof content === "string") {
    return content
  }
  if (!Array.isArray(content)) {
    return null
  }

  const hasImage = content.some((block) => block.type === "image")
  if (!hasImage) {
    return content
      .filter(
        (block): block is AnthropicTextBlock | AnthropicThinkingBlock =>
          block.type === "text" || block.type === "thinking",
      )
      .map((block) => (block.type === "text" ? block.text : block.thinking))
      .join("\n\n")
  }

  const contentParts: Array<ContentPart> = []
  for (const block of content) {
    switch (block.type) {
      case "text": {
        contentParts.push({ type: "text", text: block.text })

        break
      }
      case "thinking": {
        contentParts.push({ type: "text", text: block.thinking })

        break
      }
      case "image": {
        contentParts.push({
          type: "image_url",
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        })

        break
      }
      // No default
    }
  }
  return contentParts
}

function translateAnthropicToolsToOpenAI(
  anthropicTools: Array<AnthropicTool> | undefined,
): Array<Tool> | undefined {
  if (!anthropicTools) {
    return undefined
  }
  return anthropicTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: normalizeAnthropicToolInputSchema(tool.input_schema),
    },
  }))
}

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

function translateAnthropicToolChoiceToOpenAI(
  anthropicToolChoice: AnthropicMessagesPayload["tool_choice"],
): ChatCompletionsPayload["tool_choice"] {
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
          function: { name: anthropicToolChoice.name },
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

// Response translation

/** @deprecated Use serializeToAnthropic() instead for new code */
export function translateToAnthropic(
  response: ChatCompletionResponse,
): AnthropicResponse {
  // Merge content from all choices
  const allTextBlocks: Array<AnthropicTextBlock> = []
  const allToolUseBlocks: Array<AnthropicToolUseBlock> = []
  let stopReason: "stop" | "length" | "tool_calls" | "content_filter" | null =
    null // default
  stopReason = response.choices[0]?.finish_reason ?? stopReason

  // Process all choices to extract text and tool use blocks
  for (const choice of response.choices) {
    const textBlocks = getAnthropicTextBlocks(choice.message.content)
    const toolUseBlocks = getAnthropicToolUseBlocks(choice.message.tool_calls)

    allTextBlocks.push(...textBlocks)
    allToolUseBlocks.push(...toolUseBlocks)

    // Use the finish_reason from the first choice, or prioritize tool_calls
    if (choice.finish_reason === "tool_calls" || stopReason === "stop") {
      stopReason = choice.finish_reason
    }
  }

  // Note: GitHub Copilot doesn't generate thinking blocks, so we don't include them in responses

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content: [...allTextBlocks, ...allToolUseBlocks],
    stop_reason: mapOpenAIStopReasonToAnthropic(stopReason),
    stop_sequence: null,
    usage: {
      input_tokens:
        (response.usage?.prompt_tokens ?? 0)
        - (response.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      output_tokens: response.usage?.completion_tokens ?? 0,
      ...(response.usage?.prompt_tokens_details?.cached_tokens
        !== undefined && {
        cache_read_input_tokens:
          response.usage.prompt_tokens_details.cached_tokens,
      }),
    },
  }
}

function getAnthropicTextBlocks(
  messageContent: Message["content"],
): Array<AnthropicTextBlock> {
  if (typeof messageContent === "string") {
    return [{ type: "text", text: messageContent }]
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => ({ type: "text", text: part.text }))
  }

  return []
}

function getAnthropicToolUseBlocks(
  toolCalls: Array<ToolCall> | undefined,
): Array<AnthropicToolUseBlock> {
  if (!toolCalls) {
    return []
  }
  return toolCalls.map((toolCall) => ({
    type: "tool_use",
    id: toolCall.id,
    name: toolCall.function.name,
    input: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
  }))
}
