import consola from "consola"

import type {
  CanonicalRequest,
  CanonicalResponse,
  CIFContentPart,
  CIFMessage,
  CIFStreamEvent,
  CIFStreamStart,
  CIFContentDelta,
  CIFStreamEnd,
} from "~/cif/types"
import type { ProviderAdapter } from "~/providers/types"
import type {
  InputContentBlock,
  InputItem,
  OutputItem,
  ResponsesPayload,
  ResponsesTool,
} from "~/routes/responses/types"
import type {
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "~/services/copilot/create-chat-completions"

import { canonicalRequestToChatCompletionsPayload } from "~/serialization/to-openai-payload"

import type { AzureOpenAIProvider } from "./handlers"

import { isCodexModel, isResponsesApiModel } from "./api"
import { extractResponsesOutputTexts } from "./responses"

/**
 * Azure OpenAI Provider Adapter
 * Uses OpenAI format passthrough with Azure-specific model mapping
 */
export class AzureOpenAIAdapter implements ProviderAdapter {
  readonly provider: AzureOpenAIProvider

  constructor(provider: AzureOpenAIProvider) {
    this.provider = provider
  }

  async execute(request: CanonicalRequest): Promise<CanonicalResponse> {
    // Check if this is a responses API model (like GPT-5.3-codex)
    if (isResponsesApiModel(request.model)) {
      consola.debug(
        `[AzureOpenAIAdapter] Using Responses API for model: ${request.model}`,
      )
      return this.executeResponsesAPI(request)
    }

    consola.debug(
      `[AzureOpenAIAdapter] Using regular path for model: ${request.model}`,
    )

    // Check if this is a Codex model
    if (isCodexModel(request.model)) {
      consola.debug(
        `[AzureOpenAIAdapter] Detected Codex model: ${request.model}`,
      )
    }

    const payload = canonicalRequestToChatCompletionsPayload(request)

    // Apply model remapping if needed
    if (this.remapModel) {
      const originalModel = payload.model
      payload.model = this.remapModel(request.model)
      if (payload.model !== originalModel) {
        consola.debug(
          `[AzureOpenAIAdapter] Model remapped: ${originalModel} -> ${payload.model}`,
        )
      }
    }

    consola.debug(
      `[AzureOpenAIAdapter] Sending request to Azure OpenAI with model: ${payload.model}`,
    )
    // Note: Codex models are automatically routed to /completions endpoint by the provider
    const response = await this.provider.createChatCompletions(
      payload as Record<string, unknown>,
    )
    if (!response.ok) {
      const errorMsg = `Azure OpenAI API error: ${response.status} ${response.statusText}`
      consola.error(`[AzureOpenAIAdapter] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    const json = (await response.json()) as ChatCompletionResponse
    consola.debug(
      `[AzureOpenAIAdapter] Received response with ${json.choices?.length || 0} choices`,
    )

    return {
      id: json.id,
      model: request.model, // Return original model name
      content: this.mergeChoicesContent(json.choices || []),
      stopReason: this.convertFinishReason(json.choices[0]?.finish_reason),
      stopSequence: null, // OpenAI doesn't provide stop sequences
      usage:
        json.usage ?
          {
            inputTokens:
              json.usage.prompt_tokens
              - (json.usage.prompt_tokens_details?.cached_tokens ?? 0),
            outputTokens: json.usage.completion_tokens,
            cacheReadInputTokens:
              json.usage.prompt_tokens_details?.cached_tokens,
          }
        : undefined,
    }
  }

  /**
   * Execute request using Azure Responses API for GPT-5.x-codex models
   */
  private async executeResponsesAPI(
    request: CanonicalRequest,
  ): Promise<CanonicalResponse> {
    // Convert canonical request to responses API format
    const payload = this.canonicalRequestToResponsesPayload(request)

    const response = await this.provider.createResponses(payload)

    if (!response.ok) {
      const errorMsg = `Azure Responses API error: ${response.status} ${response.statusText}`
      consola.error(`[AzureOpenAIAdapter] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    const json = (await response.json()) as any

    consola.info(
      `[AzureOpenAIAdapter] Received responses API response: id=${json.id ?? "unknown"}, model=${json.model ?? request.model}, output_items=${Array.isArray(json.output) ? json.output.length : 0}, has_output_text=${Boolean(json.output_text)}, has_usage=${Boolean(json.usage)}`,
    )
    consola.debug(`[AzureOpenAIAdapter] Received responses API response`)

    return {
      id: json.id || `resp_${Date.now()}`,
      model: request.model, // Return original model name
      content: this.convertResponsesContent(json),
      stopReason: this.convertResponsesStopReason(json),
      stopSequence: null,
      usage:
        json.usage ?
          {
            inputTokens: json.usage.input_tokens || 0,
            outputTokens: json.usage.output_tokens || 0,
          }
        : undefined,
    }
  }

  /**
   * Convert canonical request to Responses API payload format
   */
  private canonicalRequestToResponsesPayload(
    request: CanonicalRequest,
  ): ResponsesPayload & Record<string, unknown> {
    const input = request.messages.flatMap((message) =>
      this.convertMessageToResponsesInput(message),
    )

    const modelLower = request.model.toLowerCase()
    const noTemperatureModels = ["gpt-5.4-pro", "gpt-5.1-codex-max"]
    const supportsTemperature = !noTemperatureModels.some((model) =>
      modelLower.includes(model),
    )

    const payload: ResponsesPayload & Record<string, unknown> = {
      model: request.model,
      input,
      instructions: request.systemPrompt,
      max_output_tokens: Math.max(request.maxTokens || 4000, 16),
      stream: false,
      generate: true,
      store: false,
    }

    const tools = this.convertToolsToResponses(request)
    if (tools) {
      payload.tools = tools
      // Ensure we explicitly request tool calls
      payload.tool_choice = "auto"
    }

    if (supportsTemperature && request.temperature !== undefined) {
      payload.temperature = request.temperature
    } else if (supportsTemperature) {
      payload.temperature = 0.1
    }

    return payload
  }

  /**
   * Convert responses API content to canonical format
   */
  private convertResponsesContent(json: any): Array<CIFContentPart> {
    const content: Array<CIFContentPart> = []

    // Check for tool calls in different locations
    if (json.tool_calls && Array.isArray(json.tool_calls)) {
      for (const toolCall of json.tool_calls) {
        content.push({
          type: "tool_call",
          toolCallId: toolCall.id || `call_${Date.now()}`,
          toolName: toolCall.function?.name || toolCall.name || "",
          toolArguments: this.parseToolArguments(
            toolCall.function?.arguments || toolCall.arguments || "{}",
          ),
        })
      }
    }

    // Check for choices-based tool calls (like OpenAI format)
    if (
      json.choices
      && Array.isArray(json.choices)
      && json.choices.length > 0
    ) {
      const choice = json.choices[0]
      if (
        choice.message?.tool_calls
        && Array.isArray(choice.message.tool_calls)
      ) {
        for (const toolCall of choice.message.tool_calls) {
          content.push({
            type: "tool_call",
            toolCallId: toolCall.id || `call_${Date.now()}`,
            toolName: toolCall.function?.name || "",
            toolArguments: this.parseToolArguments(
              toolCall.function?.arguments || "{}",
            ),
          })
        }
      }
    }

    const outputItems =
      Array.isArray(json.output) ? (json.output as Array<OutputItem>) : []

    for (const item of outputItems) {
      if (item.type === "message") {
        for (const block of item.content ?? []) {
          if (block.type === "output_text" && block.text) {
            content.push({
              type: "text",
              text: block.text,
            })
          }
        }
      }

      if (item.type === "function_call") {
        content.push({
          type: "tool_call",
          toolCallId: item.id || item.call_id || `call_${Date.now()}`,
          toolName: item.name ?? "",
          toolArguments: this.parseToolArguments(item.arguments ?? "{}"),
        })
      }

      // Check for other possible tool call formats
      if (item.type === "tool_call" || item.type === "tool_use") {
        content.push({
          type: "tool_call",
          toolCallId: item.id || `call_${Date.now()}`,
          toolName: item.name || item.tool_name || "",
          toolArguments: this.parseToolArguments(
            item.arguments || item.parameters || "{}",
          ),
        })
      }
    }

    if (content.length === 0) {
      return extractResponsesOutputTexts(json).map((text) => ({
        type: "text" as const,
        text,
      }))
    }

    return content
  }

  /**
   * Convert responses API stop reason to canonical format
   */
  private convertResponsesStopReason(
    json: any,
  ): CanonicalResponse["stopReason"] {
    if (
      Array.isArray(json.output)
      && json.output.some((item: OutputItem) => item.type === "function_call")
    ) {
      return "tool_use"
    }

    // Azure Responses API uses different status fields
    // Check the overall response status first
    if (json.status === "completed") {
      // Check if any output has a specific completion reason
      if (json.output && Array.isArray(json.output) && json.output.length > 0) {
        const output = json.output[0]
        if (output.status === "completed") {
          return "end_turn"
        }
      }
      return "end_turn"
    }

    // Check for legacy format compatibility
    const stopReason = json.choices?.[0]?.finish_reason || json.stop_reason
    switch (stopReason) {
      case "stop":
      case "end_turn": {
        return "end_turn"
      }
      case "length":
      case "max_tokens": {
        return "max_tokens"
      }
      case "tool_calls":
      case "tool_use": {
        return "tool_use"
      }
      case "content_filter": {
        return "content_filter"
      }
      default: {
        return "end_turn"
      }
    }
  }

  /**
   * Convert tool call ID to Azure-compatible format
   * Azure requires IDs to start with 'fc'
   */
  private convertToAzureToolCallId(toolCallId: string): string {
    if (toolCallId.startsWith("fc")) {
      return toolCallId
    }
    // Replace any prefix with 'fc' and ensure valid format
    return `fc_${toolCallId.replace(/^[^_]*_?/, "")}`
  }

  private convertMessageToResponsesInput(
    message: CIFMessage,
  ): Array<InputItem> {
    if (message.role === "system") {
      return [
        {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: message.content,
            },
          ],
        },
      ]
    }

    const items: Array<InputItem> = []
    let currentBlocks: Array<InputContentBlock> = []

    const flushMessage = () => {
      if (currentBlocks.length === 0) {
        return
      }

      items.push({
        type: "message",
        role: message.role,
        content: currentBlocks,
      })
      currentBlocks = []
    }

    for (const part of message.content) {
      if (part.type === "text") {
        currentBlocks.push({
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: part.text,
        })
        continue
      }

      if (part.type === "tool_call" && message.role === "assistant") {
        flushMessage()
        const azureToolCallId = this.convertToAzureToolCallId(part.toolCallId)
        items.push({
          type: "function_call",
          id: azureToolCallId,
          call_id: azureToolCallId,
          name: part.toolName,
          arguments: this.stringifyToolArguments(part.toolArguments),
        })
        continue
      }

      if (part.type === "tool_result" && message.role === "user") {
        flushMessage()
        const azureToolCallId = this.convertToAzureToolCallId(part.toolCallId)
        items.push({
          type: "function_call_output",
          call_id: azureToolCallId,
          output: this.serializeToolResultContent(part.content),
          // Note: Azure OpenAI responses API doesn't accept 'name' field for function_call_output
        })
      }
    }

    flushMessage()
    return items
  }

  private convertToolsToResponses(
    request: CanonicalRequest,
  ): Array<ResponsesTool> | undefined {
    if (!request.tools || request.tools.length === 0) {
      return undefined
    }

    return request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
    }))
  }

  private convertToolChoiceToResponses(request: CanonicalRequest) {
    if (!request.toolChoice) {
      return undefined
    }

    if (typeof request.toolChoice === "string") {
      return request.toolChoice
    }

    // Azure Responses API only supports 'none', 'auto', 'required'
    // For forced function calls, use 'required'
    return "required"
  }

  private stringifyToolArguments(
    argumentsValue: Record<string, unknown>,
  ): string {
    const serialized = JSON.stringify(argumentsValue)
    return serialized === undefined ? "{}" : serialized
  }

  private serializeToolResultContent(content: unknown): string {
    if (typeof content === "string") {
      return content
    }

    if (Array.isArray(content)) {
      const textParts = content
        .filter(
          (part): part is { type: string; text: string } =>
            Boolean(part)
            && typeof part === "object"
            && "type" in part
            && part.type === "text"
            && "text" in part
            && typeof part.text === "string",
        )
        .map((part) => part.text)

      if (textParts.length > 0) {
        return textParts.join("\n\n")
      }
    }

    if (content === null || content === undefined) {
      return ""
    }

    if (typeof content === "object") {
      const serialized = JSON.stringify(content)
      return serialized === undefined ? "" : serialized
    }

    return String(content)
  }

  private parseToolArguments(argumentsStr: string): Record<string, unknown> {
    try {
      return JSON.parse(argumentsStr)
    } catch {
      return { _unparsable_arguments: argumentsStr }
    }
  }

  async *executeStream(
    request: CanonicalRequest,
  ): AsyncGenerator<CIFStreamEvent> {
    consola.debug(
      `[AzureOpenAIAdapter] Starting stream execution for model: ${request.model}`,
    )

    let response: Response

    if (isResponsesApiModel(request.model)) {
      consola.debug(
        `[AzureOpenAIAdapter] Using Responses API for streaming model: ${request.model}`,
      )
      const payload = this.canonicalRequestToResponsesPayload(request)
      payload.stream = true

      if (this.remapModel) {
        const originalModel = payload.model
        payload.model = this.remapModel(request.model)
        if (payload.model !== originalModel) {
          consola.debug(
            `[AzureOpenAIAdapter] Stream model remapped: ${originalModel} -> ${payload.model}`,
          )
        }
      }

      response = await this.provider.createResponses(
        payload as Record<string, unknown>,
        { rawResponse: true },
      )
    } else {
      // Check if this is a Codex model
      if (isCodexModel(request.model)) {
        consola.debug(
          `[AzureOpenAIAdapter] Detected Codex model for streaming: ${request.model}`,
        )
      }

      const payload = canonicalRequestToChatCompletionsPayload(request)
      payload.stream = true

      // Apply model remapping if needed
      if (this.remapModel) {
        const originalModel = payload.model
        payload.model = this.remapModel(request.model)
        if (payload.model !== originalModel) {
          consola.debug(
            `[AzureOpenAIAdapter] Stream model remapped: ${originalModel} -> ${payload.model}`,
          )
        }
      }

      response = await this.provider.createChatCompletions(
        payload as Record<string, unknown>,
      )
    }
    if (!response.ok) {
      const errorMsg = `Azure OpenAI API error: ${response.status} ${response.statusText}`
      consola.error(`[AzureOpenAIAdapter] Stream ${errorMsg}`)
      throw new Error(errorMsg)
    }

    if (!response.body) {
      consola.error(
        "[AzureOpenAIAdapter] No response body for streaming request",
      )
      throw new Error("No response body for streaming request")
    }

    let streamId: string | undefined
    let contentIndex = 0
    let eventCount = 0
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    const parseEvent = (data: string) => {
      if (data === "[DONE]") {
        consola.debug("[AzureOpenAIAdapter] Received [DONE] marker")
        return {
          events: [] as Array<CIFStreamEvent>,
          shouldStop: true,
        }
      }

      try {
        const parsed = JSON.parse(data) as ChatCompletionChunk
        const events: Array<CIFStreamEvent> = []

        if (!streamId && parsed.id) {
          streamId = parsed.id
          consola.debug(
            `[AzureOpenAIAdapter] Emitting stream_start with id: ${parsed.id}`,
          )
          const startEvent: CIFStreamStart = {
            type: "stream_start",
            id: parsed.id,
            model: request.model, // Return original model name
          }
          events.push(startEvent)
        }

        const choice = parsed.choices?.[0]
        if (choice?.delta) {
          // Handle content delta
          if (choice.delta.content) {
            consola.debug(
              `[AzureOpenAIAdapter] Processing text delta: ${choice.delta.content.length} chars`,
            )
            const deltaEvent: CIFContentDelta = {
              type: "content_delta",
              index: contentIndex,
              contentBlock: { type: "text", text: "" },
              delta: { type: "text_delta", text: choice.delta.content },
            }
            events.push(deltaEvent)
          }

          // Handle tool calls
          if (choice.delta.tool_calls) {
            for (const toolCall of choice.delta.tool_calls) {
              if (toolCall.function?.name) {
                consola.debug(
                  `[AzureOpenAIAdapter] Processing new tool call: ${toolCall.function.name}`,
                )
                // New tool call
                const deltaEvent: CIFContentDelta = {
                  type: "content_delta",
                  index: contentIndex++,
                  contentBlock: {
                    type: "tool_call",
                    toolCallId: toolCall.id || "",
                    toolName: toolCall.function.name,
                    toolArguments: {},
                  },
                  delta: {
                    type: "tool_arguments_delta",
                    partialJson: toolCall.function.arguments || "",
                  },
                }
                events.push(deltaEvent)
              } else if (toolCall.function?.arguments) {
                consola.debug(
                  `[AzureOpenAIAdapter] Processing tool arguments delta`,
                )
                // Tool call arguments delta
                const deltaEvent: CIFContentDelta = {
                  type: "content_delta",
                  index: contentIndex - 1, // Use previous index
                  delta: {
                    type: "tool_arguments_delta",
                    partialJson: toolCall.function.arguments,
                  },
                }
                events.push(deltaEvent)
              }
            }
          }

          // Handle finish reason
          if (choice.finish_reason) {
            const stopReason = this.convertFinishReason(choice.finish_reason)
            consola.debug(
              `[AzureOpenAIAdapter] Stream ending with reason: ${stopReason}`,
            )
            const endEvent: CIFStreamEnd = {
              type: "stream_end",
              stopReason,
              stopSequence: null,
              usage:
                parsed.usage ?
                  {
                    inputTokens: parsed.usage.prompt_tokens || 0,
                    outputTokens: parsed.usage.completion_tokens || 0,
                  }
                : undefined,
            }
            events.push(endEvent)
            return {
              events,
              shouldStop: true,
            }
          }
        }

        return {
          events,
          shouldStop: false,
        }
      } catch (error) {
        consola.warn(`[AzureOpenAIAdapter] Failed to parse SSE chunk: ${error}`)
        return {
          events: [] as Array<CIFStreamEvent>,
          shouldStop: false,
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          buffer += decoder.decode()
          if (buffer.length > 0) {
            const pendingEvents = buffer.split("\n\n")
            for (const rawEvent of pendingEvents) {
              const line = rawEvent
                .split("\n")
                .find((eventLine) => eventLine.startsWith("data: "))
              if (!line) {
                continue
              }

              const { events, shouldStop } = parseEvent(line.slice(6).trim())
              for (const event of events) {
                yield event
                eventCount++
              }
              if (shouldStop) {
                return
              }
            }
          }
          consola.debug(
            `[AzureOpenAIAdapter] Stream completed after ${eventCount} events`,
          )
          break
        }

        buffer += decoder.decode(value, { stream: true })

        while (true) {
          const eventBoundary = buffer.indexOf("\n\n")
          if (eventBoundary === -1) {
            break
          }

          const rawEvent = buffer.slice(0, eventBoundary)
          buffer = buffer.slice(eventBoundary + 2)

          const line = rawEvent
            .split("\n")
            .find((eventLine) => eventLine.startsWith("data: "))
          if (!line) {
            continue
          }

          const { events, shouldStop } = parseEvent(line.slice(6).trim())
          for (const event of events) {
            yield event
            eventCount++
          }
          if (shouldStop) {
            return
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  remapModel(canonicalModel: string): string {
    // Azure OpenAI uses deployment names instead of model names
    // This could be configured per instance, but for now use the model as-is
    return canonicalModel
  }

  private mergeChoicesContent(choices: Array<any>) {
    const allContent = []

    for (const choice of choices) {
      const choiceContent = this.convertOpenAIContent(choice?.message)
      allContent.push(...choiceContent)
    }

    return allContent
  }

  private convertOpenAIContent(message: any) {
    const content = []

    if (message?.content) {
      content.push({
        type: "text" as const,
        text: message.content,
      })
    }

    if (message?.tool_calls) {
      for (const toolCall of message.tool_calls) {
        content.push({
          type: "tool_call" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          toolArguments: JSON.parse(toolCall.function.arguments || "{}"),
        })
      }
    }

    return content
  }

  private convertFinishReason(
    reason: string | undefined,
  ): CanonicalResponse["stopReason"] {
    switch (reason) {
      case "stop": {
        return "end_turn"
      }
      case "length": {
        return "max_tokens"
      }
      case "tool_calls": {
        return "tool_use"
      }
      case "content_filter": {
        return "content_filter"
      }
      default: {
        return "end_turn"
      }
    }
  }
}
