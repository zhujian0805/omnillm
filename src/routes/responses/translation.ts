import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  Message,
  Tool,
  ToolCall,
} from "~/services/copilot/create-chat-completions"

import type {
  InputContentBlock,
  InputItem,
  OutputItem,
  ResponsesEvent,
  ResponsesPayload,
  ResponsesResponse,
  ResponsesTool,
} from "./types"

function generateId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 11)
  const timePart = Date.now().toString(36)
  return `${prefix}${timePart}${randomPart}`
}

export function translateRequestToOpenAI(
  payload: ResponsesPayload,
): ChatCompletionsPayload {
  const systemMessage: Array<Message> =
    payload.instructions ?
      [{ role: "system", content: payload.instructions }]
    : []

  const messages: Array<Message> =
    typeof payload.input === "string" ?
      [...systemMessage, { role: "user", content: payload.input }]
    : [
        ...systemMessage,
        ...payload.input.map((item) => {
          return {
            role: item.role as Message["role"],
            content: extractInputItemText(item.content),
          }
        }),
      ]

  // Convert flat ResponsesTool format → nested OpenAI Tool format
  const validTools =
    payload.tools?.filter((tool) => tool.name.trim().length > 0) ?? []
  const tools: Array<Tool> | undefined =
    validTools.length > 0 ?
      validTools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          ...(tool.description && { description: tool.description }),
          parameters: tool.parameters,
        },
      }))
    : undefined

  return {
    model: payload.model,
    messages,
    stream: payload.stream ?? false,
    temperature: payload.temperature,
    top_p: payload.top_p,
    max_tokens: payload.max_output_tokens,
    ...(tools
      && tools.length > 0 && { tools, tool_choice: payload.tool_choice }),
  }
}

let responseId: string
let outputItem: OutputItem

function extractInputItemText(
  content: string | Array<InputContentBlock>,
): string {
  return typeof content === "string" ? content : (
      content.map((part) => part.text).join("")
    )
}

function isTextContentPart(
  part: unknown,
): part is { type: "text"; text: string } {
  return (
    typeof part === "object"
    && part !== null
    && "type" in part
    && part.type === "text"
    && "text" in part
    && typeof part.text === "string"
  )
}

export function resetStreamState() {
  responseId = `resp_${generateId("")}`
  outputItem = {
    type: "message",
    id: `item_${generateId("")}`,
    role: "assistant",
    content: [],
  }
}

resetStreamState()

export function translateResponseToResponses(
  response: ChatCompletionResponse,
): ResponsesResponse {
  const choice = response.choices[0]
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!choice?.message) {
    throw new Error("No message in response")
  }

  const message = choice.message

  const outputItems: Array<OutputItem> = []

  // Main message item
  const messageItem: OutputItem = {
    type: "message",
    id: `item_${generateId("")}`,
    role: "assistant",
    content: [],
  }

  if (typeof message.content === "string" && message.content) {
    messageItem.content.push({
      type: "output_text",
      text: message.content,
    })
  }

  outputItems.push(messageItem)

  // Tool calls as separate items
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      outputItems.push({
        type: "function_call",
        id: toolCall.id,
        role: "assistant",
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      })
    }
  }

  return {
    id: `resp_${generateId("")}`,
    object: "realtime.response",
    model: response.model,
    output: outputItems,
    usage:
      response.usage ?
        {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
        }
      : undefined,
    created_at: response.created,
  }
}

export interface StreamState {
  messageStartSent: boolean
  currentContent: string
  toolCallIndex: number
  activateToolCall: { index: number; id: string; name: string } | null
}

export function initStreamState(): StreamState {
  resetStreamState()
  return {
    messageStartSent: false,
    currentContent: "",
    toolCallIndex: -1,
    activateToolCall: null,
  }
}

function emitStartEvents(
  chunk: ChatCompletionChunk,
  finalUsage: { prompt_tokens: number; completion_tokens: number } | undefined,
): Array<ResponsesEvent> {
  const resp: ResponsesResponse = {
    id: responseId,
    object: "realtime.response",
    model: chunk.model,
    output: [outputItem],
    usage:
      finalUsage ?
        {
          input_tokens: finalUsage.prompt_tokens,
          output_tokens: finalUsage.completion_tokens,
        }
      : undefined,
    created_at: chunk.created,
  }

  return [
    { type: "response.created", response: resp },
    { type: "response.output_item.added", item: outputItem },
    {
      type: "response.content_block.added",
      content_block: { type: "output_text" },
    },
  ]
}

function emitContentDelta(content: string): Array<ResponsesEvent> {
  return [{ type: "response.output_text.delta", delta: content }]
}

function emitFinishEvents(
  chunk: ChatCompletionChunk,
  currentContent: string,
  finalUsage: { prompt_tokens: number; completion_tokens: number } | undefined,
): Array<ResponsesEvent> {
  const finalResp: ResponsesResponse = {
    id: responseId,
    object: "realtime.response",
    model: chunk.model,
    output: [outputItem],
    usage:
      finalUsage ?
        {
          input_tokens: finalUsage.prompt_tokens,
          output_tokens: finalUsage.completion_tokens,
        }
      : undefined,
    created_at: chunk.created,
  }

  return [
    { type: "response.output_text.done", text: currentContent },
    { type: "response.output_item.done", item: outputItem },
    { type: "response.completed", response: finalResp },
  ]
}

function emitToolCallStartEvent(
  toolCall: {
    index?: number
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  },
  state: StreamState,
): ResponsesEvent | null {
  if (toolCall.index === undefined || toolCall.index <= state.toolCallIndex) {
    return null
  }

  state.toolCallIndex = toolCall.index
  state.activateToolCall = {
    index: toolCall.index,
    id: toolCall.id || `call_${generateId("")}`,
    name: toolCall.function?.name || "",
  }

  const funcItem: OutputItem = {
    type: "function_call",
    id: state.activateToolCall.id,
    role: "assistant",
    name: state.activateToolCall.name,
    arguments: toolCall.function?.arguments || "",
  }

  outputItem.content.push({
    type: "function_parameters",
  })

  return { type: "response.output_item.added", item: funcItem }
}

export function translateChunkToResponsesEvents(
  chunk: ChatCompletionChunk,
  state: StreamState,
  finalUsage?: { prompt_tokens: number; completion_tokens: number },
): Array<ResponsesEvent> {
  const events: Array<ResponsesEvent> = []

  const choice = chunk.choices[0]

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!choice) return events

  // First chunk: emit response.created, output_item.added, content_block.added
  if (!state.messageStartSent) {
    state.messageStartSent = true
    events.push(...emitStartEvents(chunk, finalUsage))
  }

  // Handle delta content
  if (choice.delta.content) {
    state.currentContent += choice.delta.content
    events.push(...emitContentDelta(choice.delta.content))
  }

  // Handle tool calls
  if (choice.delta.tool_calls && choice.delta.tool_calls.length > 0) {
    for (const toolCall of choice.delta.tool_calls) {
      const toolEvent = emitToolCallStartEvent(toolCall, state)
      if (toolEvent) {
        events.push(toolEvent)
      }

      // Update tool call name if available
      if (toolCall.function?.name && state.activateToolCall) {
        state.activateToolCall.name = toolCall.function.name
      }
    }
  }

  // On finish, emit done events
  if (choice.finish_reason) {
    events.push(...emitFinishEvents(chunk, state.currentContent, finalUsage))
  }

  return events
}

// ---------------------------------------------------------------------------
// Reverse translation: ChatCompletionsPayload → ResponsesPayload
// ---------------------------------------------------------------------------

function extractTextContent(
  content: string | Array<ContentPart> | null,
): string {
  if (typeof content === "string") {
    return content
  }
  if (Array.isArray(content)) {
    const textParts: Array<string> = []
    for (const part of content as Array<unknown>) {
      if (isTextContentPart(part)) {
        textParts.push(part.text)
      }
    }
    return textParts.join("")
  }
  return ""
}

export function chatCompletionsToResponsesPayload(
  payload: ChatCompletionsPayload,
): ResponsesPayload {
  const systemMessages = payload.messages.filter((msg) => msg.role === "system")
  const nonSystemMessages = payload.messages.filter(
    (msg) => msg.role !== "system",
  )

  const instructions =
    systemMessages.length > 0 ?
      systemMessages.map((msg) => extractTextContent(msg.content)).join("\n\n")
    : undefined

  const input: Array<InputItem> = nonSystemMessages
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .map((msg) => {
      const text = extractTextContent(msg.content)
      return {
        type: "message" as const,
        role: msg.role as "user" | "assistant",
        content: text,
      }
    })

  const maxTokens =
    payload.max_tokens !== null && payload.max_tokens !== undefined ?
      Math.max(16, payload.max_tokens)
    : undefined

  // Convert nested OpenAI Tool format → flat ResponsesTool format
  const validTools =
    payload.tools
      ?.filter((tool) => tool.function.name.trim().length > 0)
      .map((tool) => ({
        type: "function" as const,
        name: tool.function.name,
        ...(tool.function.description && {
          description: tool.function.description,
        }),
        parameters: tool.function.parameters,
      })) ?? []
  const tools: Array<ResponsesTool> | undefined =
    validTools.length > 0 ? validTools : undefined

  return {
    model: payload.model,
    input,
    instructions,
    stream: payload.stream ?? false,
    temperature: payload.temperature,
    top_p: payload.top_p,
    max_output_tokens: maxTokens,
    ...(tools
      && tools.length > 0 && {
        tools,
        tool_choice: payload.tool_choice,
      }),
  }
}

// ---------------------------------------------------------------------------
// Reverse translation: ResponsesResponse → ChatCompletionResponse
// ---------------------------------------------------------------------------

export function responsesResponseToChatCompletions(
  response: ResponsesResponse,
): ChatCompletionResponse {
  const messageItem = response.output.find((item) => item.type === "message")
  const funcItems = response.output.filter(
    (item) => item.type === "function_call",
  )

  const textContent =
    messageItem?.content
      ?.filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("") ?? null

  let toolCalls: Array<ToolCall> | undefined
  if (funcItems.length > 0) {
    toolCalls = funcItems.map((item) => ({
      id: item.id,
      type: "function" as const,
      function: {
        name: item.name ?? "",
        arguments: item.arguments ?? "",
      },
    }))
  }

  const finishReason = toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop"

  return {
    id: response.id,
    object: "chat.completion",
    created: response.created_at ?? Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textContent,
          ...(toolCalls && { tool_calls: toolCalls }),
        },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
    ...(response.usage && {
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens:
          response.usage.input_tokens + response.usage.output_tokens,
      },
    }),
  }
}

// ---------------------------------------------------------------------------
// Reverse streaming: ResponsesEvent → ChatCompletionChunk (if applicable)
// ---------------------------------------------------------------------------

interface ChunkMetadata {
  model: string
  chunkId: string
  created: number
}

export function responsesEventToChatChunk(
  event: ResponsesEvent,
  metadata: ChunkMetadata,
): ChatCompletionChunk | null {
  const { model, chunkId, created } = metadata

  if (event.type === "response.output_text.delta") {
    const delta = event as { type: string; delta: string }
    return {
      id: chunkId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: { content: delta.delta },
          finish_reason: null,
          logprobs: null,
        },
      ],
    }
  }

  if (event.type === "response.completed") {
    const completed = event as { type: string; response: ResponsesResponse }
    const resp = completed.response
    const funcItems = resp.output.filter(
      (item) => item.type === "function_call",
    )
    const finishReason =
      funcItems.length > 0 ? ("tool_calls" as const) : ("stop" as const)

    const toolCallDeltas =
      funcItems.length > 0 ?
        funcItems.map((item, i) => ({
          index: i,
          id: item.id,
          type: "function" as const,
          function: {
            name: item.name ?? "",
            arguments: item.arguments ?? "",
          },
        }))
      : undefined

    return {
      id: chunkId,
      object: "chat.completion.chunk",
      created,
      model: resp.model,
      choices: [
        {
          index: 0,
          delta: toolCallDeltas ? { tool_calls: toolCallDeltas } : {},
          finish_reason: finishReason,
          logprobs: null,
        },
      ],
      ...(resp.usage && {
        usage: {
          prompt_tokens: resp.usage.input_tokens,
          completion_tokens: resp.usage.output_tokens,
          total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
        },
      }),
    }
  }

  return null
}
