import consola from "consola"
import { unlink } from "node:fs/promises"

import type { Provider } from "~/providers/types"
import type { ModelsResponse } from "~/services/copilot/get-models"

import { ModelConfigStore } from "~/lib/database"
import { HTTPError } from "~/lib/error"
import { PATHS } from "~/lib/paths"
import { providerRegistry } from "~/providers/registry"

import { AzureOpenAIAdapter } from "./adapter"
import {
  buildAzureChatUrl,
  buildAzureEmbeddingsUrl,
  buildAzureCompletionsUrl,
  buildAzureResponsesUrl,
  getAzureOpenAIBaseUrl,
  getAzureOpenAIHeaders,
  isCodexModel,
  isResponsesApiModel,
} from "./api"
import {
  readAzureOpenAIToken,
  resourceNameFromEndpoint,
  writeAzureOpenAIToken,
  type AzureOpenAITokenData,
} from "./auth"
import { AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS } from "./constants"
import { extractResponsesOutputText } from "./responses"

export class AzureOpenAIProvider implements Provider {
  id = "azure-openai" as const
  instanceId: string
  name: string

  private tokenData: AzureOpenAITokenData | null = null

  // CIF Adapter
  readonly adapter = new AzureOpenAIAdapter(this)

  constructor(instanceId: string) {
    this.instanceId = instanceId
    this.name = "Azure OpenAI"
  }

  async setupAuth(options?: {
    force?: boolean
    apiKey?: string
    endpoint?: string
    apiVersion?: string
    deployments?: string
  }): Promise<void> {
    if (!options?.force) {
      const existing = await readAzureOpenAIToken(this.instanceId)
      if (existing) {
        this.tokenData = existing
        this.name = `Azure OpenAI (${existing.resource_name})`
        return
      }
    }

    if (options?.apiKey && options.endpoint) {
      // Called from admin API with credentials already provided
      return
    }

    // Interactive CLI flow
    const { normalizeEndpoint } = await import("./auth")
    const { AZURE_OPENAI_DEFAULT_API_VERSION } = await import("./constants")

    const endpoint = await consola.prompt("Enter your Azure OpenAI endpoint", {
      type: "text",
      placeholder: "https://my-resource.openai.azure.com",
    })
    const apiKey = await consola.prompt("Enter your Azure OpenAI API key", {
      type: "text",
    })
    const apiVersion = await consola.prompt("Enter API version", {
      type: "text",
      default: AZURE_OPENAI_DEFAULT_API_VERSION,
    })
    const deploymentsInput = await consola.prompt(
      "Enter your deployment names (comma-separated)",
      {
        type: "text",
        placeholder: "gpt-4,gpt-35-turbo,text-embedding-ada-002",
      },
    )

    if (!endpoint || !apiKey || !deploymentsInput)
      throw new Error("Endpoint, API key, and deployments are required")

    const normalizedEndpoint = normalizeEndpoint(endpoint)
    const resource_name = resourceNameFromEndpoint(normalizedEndpoint)
    const deployments = deploymentsInput
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)

    const tokenData: AzureOpenAITokenData = {
      auth_type: "api-key",
      api_key: apiKey.trim(),
      endpoint: normalizedEndpoint,
      api_version: (apiVersion || AZURE_OPENAI_DEFAULT_API_VERSION).trim(),
      resource_name,
      deployments,
    }

    await writeAzureOpenAIToken(tokenData, this.instanceId)
    this.tokenData = tokenData
    await this.renameInstance()
    consola.success(
      `Azure OpenAI authenticated for resource: ${resource_name} with ${deployments.length} deployments`,
    )
  }

  private async renameInstance(): Promise<void> {
    if (!this.tokenData) return
    const { resource_name } = this.tokenData
    const newInstanceId = `azure-openai-${resource_name}`
    const oldInstanceId = this.instanceId

    this.name = `Azure OpenAI (${resource_name})`

    if (newInstanceId !== oldInstanceId) {
      const oldPath = PATHS.getInstanceTokenPath(oldInstanceId)
      await writeAzureOpenAIToken(this.tokenData, newInstanceId)
      try {
        await unlink(oldPath)
      } catch {
        // ignore missing old token file
      }
      this.instanceId = newInstanceId
      await providerRegistry.rename(oldInstanceId, newInstanceId)
    }
  }

  getToken(): string {
    if (!this.tokenData) throw new Error("Azure OpenAI not authenticated")
    return this.tokenData.api_key
  }

  async refreshToken(): Promise<void> {
    // API keys don't expire — just re-read from disk
    this.tokenData = await readAzureOpenAIToken(this.instanceId)
    if (!this.tokenData) throw new Error("Azure OpenAI token not found")

    // Clear cached models so they get refreshed with updated versions
    await this.clearModelCache()
  }

  async clearModelCache(): Promise<void> {
    const { state } = await import("~/lib/state")
    state.providerModels.delete(this.instanceId)
    consola.debug(`[Azure OpenAI] Cleared model cache for ${this.instanceId}`)
  }

  /**
   * Set the version for a specific model deployment
   */
  setModelVersion(deploymentName: string, version: string): void {
    ModelConfigStore.setVersion(this.instanceId, deploymentName, version)
    consola.info(
      `[Azure OpenAI] Set version ${version} for model ${deploymentName}`,
    )
    // Clear cache to force refresh
    this.clearModelCache()
  }

  /**
   * Get the version for a specific model deployment
   */
  getModelVersion(deploymentName: string): string {
    return ModelConfigStore.getVersion(this.instanceId, deploymentName)
  }

  private async ensureValidToken(): Promise<AzureOpenAITokenData> {
    if (!this.tokenData) {
      this.tokenData = await readAzureOpenAIToken(this.instanceId)
    }
    if (!this.tokenData) {
      throw new Error(
        "Azure OpenAI not authenticated. Please authorize via the admin UI.",
      )
    }

    // Migrate old API versions to the new one
    const { AZURE_OPENAI_DEFAULT_API_VERSION } = await import("./constants")
    if (this.tokenData.api_version !== AZURE_OPENAI_DEFAULT_API_VERSION) {
      consola.info(
        `[Azure OpenAI] Updating API version from ${this.tokenData.api_version} to ${AZURE_OPENAI_DEFAULT_API_VERSION}`,
      )
      this.tokenData.api_version = AZURE_OPENAI_DEFAULT_API_VERSION
      await writeAzureOpenAIToken(this.tokenData, this.instanceId)
    }

    return this.tokenData
  }

  getBaseUrl(): string {
    if (!this.tokenData) return ""
    return getAzureOpenAIBaseUrl(this.tokenData)
  }

  getHeaders(): Record<string, string> {
    if (!this.tokenData) throw new Error("Azure OpenAI not authenticated")
    return getAzureOpenAIHeaders(this.tokenData, false)
  }

  async getModels(): Promise<ModelsResponse> {
    const tokenData = await this.ensureValidToken()

    // Handle legacy token data without deployments field
    if (!tokenData.deployments || tokenData.deployments.length === 0) {
      throw new Error(
        "No deployments configured. Please delete and re-add this Azure provider to specify your deployment names.",
      )
    }

    const models = tokenData.deployments.map((deploymentName) => {
      // Get model version from database, with fallback to auto-detection
      let version = ModelConfigStore.getVersion(this.instanceId, deploymentName)

      // If no version in database, auto-detect and save
      if (version === "1") {
        if (deploymentName.includes("gpt-5.3-codex")) {
          version = "2026-02-24"
        } else if (deploymentName.includes("gpt-5.3")) {
          version = "2026-02-24"
        } else if (deploymentName.includes("gpt-5.4")) {
          version = "2026-04-01"
        } else if (deploymentName.includes("gpt-6")) {
          version = "2026-06-01"
        }

        // Save the detected version to database
        ModelConfigStore.setVersion(this.instanceId, deploymentName, version)
        consola.debug(
          `[Azure OpenAI] Auto-detected and saved version ${version} for model ${deploymentName}`,
        )
      }

      return {
        capabilities: {
          family: "azure-openai",
          limits: {
            max_context_window_tokens: 128_000,
            max_output_tokens: 4_096,
          },
          object: "model_capabilities",
          supports: { tool_calls: true },
          tokenizer: "cl100k_base",
          type: "chat",
        },
        // Use deployment name as the model ID
        id: deploymentName,
        model_picker_enabled: true,
        // Just show the deployment name
        name: deploymentName,
        object: "model",
        preview: false,
        vendor: "azure-openai",
        version,
      }
    })

    consola.debug(`Azure OpenAI: using ${models.length} configured deployments`)
    return { data: models, object: "list" }
  }

  async createChatCompletions(
    payload: Record<string, unknown>,
  ): Promise<Response> {
    const tokenData = await this.ensureValidToken()
    const stream = Boolean(payload.stream)
    const model = (payload.model as string | undefined) ?? ""

    // Check if this is a responses API model - route to responses endpoint
    if (isResponsesApiModel(model)) {
      consola.debug(
        `[Azure OpenAI] (${this.instanceId}) Detected responses API model: ${model}, routing to responses endpoint`,
      )
      return this.createResponses(payload)
    }

    // Check if this is a Codex model - route to completions endpoint
    if (isCodexModel(model)) {
      consola.debug(
        `[Azure OpenAI] (${this.instanceId}) Detected Codex model: ${model}, routing to completions endpoint`,
      )
      return this.createCompletions(payload)
    }

    const url = buildAzureChatUrl(tokenData, model)
    const headers = getAzureOpenAIHeaders(tokenData, stream)

    // Remove the model field — Azure uses deployment name in the URL, not the body
    const { model: _model, ...bodyWithoutModel } = payload
    const body = bodyWithoutModel

    // Special handling for GPT-5.3-codex models
    const isGpt53Codex = model.includes("gpt-5.3-codex")
    const isGpt53OrNewer =
      model.includes("gpt-5.3")
      || model.includes("gpt-5.4")
      || model.includes("gpt-6")

    if (isGpt53Codex) {
      // GPT-5.3-codex may require specific parameters
      // Based on Codex implementation, these models need special handling

      // Ensure temperature is reasonable for code generation
      if (!body.temperature || body.temperature > 0.5) {
        body.temperature = 0.1
        consola.debug(`[Azure OpenAI] Adjusted temperature for ${model}: 0.1`)
      }

      // Ensure reasonable token limits
      if (body.max_tokens) {
        const maxTokens =
          typeof body.max_tokens === "number" && body.max_tokens > 0 ?
            Math.min(body.max_tokens, 8000)
          : AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS // Codex models may have different limits
        body.max_completion_tokens = maxTokens
        delete body.max_tokens
        consola.debug(
          `[Azure OpenAI] Using max_completion_tokens for codex: ${maxTokens}`,
        )
      } else if (!body.max_completion_tokens) {
        body.max_completion_tokens = AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS
        consola.debug(
          `[Azure OpenAI] Set default max_completion_tokens for codex: ${AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS}`,
        )
      }

      // Remove parameters that might not be supported by codex models
      if (body.frequency_penalty !== undefined) {
        delete body.frequency_penalty
        consola.debug(
          `[Azure OpenAI] Removed frequency_penalty for codex model`,
        )
      }
      if (body.presence_penalty !== undefined) {
        delete body.presence_penalty
        consola.debug(`[Azure OpenAI] Removed presence_penalty for codex model`)
      }
    } else if (isGpt53OrNewer) {
      // For GPT-5.3+, use max_completion_tokens directly
      if (body.max_tokens) {
        const maxTokens =
          typeof body.max_tokens === "number" && body.max_tokens > 0 ?
            body.max_tokens
          : AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS
        body.max_completion_tokens = maxTokens
        delete body.max_tokens
        consola.debug(
          `[Azure OpenAI] Using max_completion_tokens for ${model}: ${maxTokens}`,
        )
      } else if (!body.max_completion_tokens) {
        body.max_completion_tokens = AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS
        consola.debug(
          `[Azure OpenAI] Set default max_completion_tokens for ${model}: ${AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS}`,
        )
      }
    } else {
      // For older models, ensure max_tokens has a reasonable default
      if (
        !body.max_tokens
        || (typeof body.max_tokens === "number" && body.max_tokens <= 0)
      ) {
        body.max_tokens = AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS
        consola.debug(
          `[Azure OpenAI] Set default max_tokens for ${model}: ${body.max_tokens}`,
        )
      }
    }

    consola.info(`📤 Azure OpenAI: ${model} | ${url} | Stream: ${stream}`)
    consola.debug(
      `[Azure OpenAI] Model type detection: isGpt53OrNewer=${isGpt53OrNewer}`,
    )
    consola.debug(
      `[Azure OpenAI] Request summary: messages=${Array.isArray(body.messages) ? body.messages.length : 0}, max_tokens=${typeof body.max_tokens === "number" ? body.max_tokens : "unset"}, max_completion_tokens=${typeof body.max_completion_tokens === "number" ? body.max_completion_tokens : "unset"}`,
    )

    let response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })

    // Some older models might still require the fallback to max_completion_tokens
    if (!response.ok) {
      const errorText = await response.text()
      consola.error(
        `[Azure OpenAI] Initial request failed (${response.status}): ${errorText}`,
      )

      // Only retry parameter conversion for non-GPT-5.3+ models that haven't already used max_completion_tokens
      if (
        !isGpt53OrNewer
        && errorText.includes("max_tokens")
        && errorText.includes("max_completion_tokens")
        && "max_tokens" in body
      ) {
        const originalMaxTokens = body.max_tokens
        // Use a reasonable default if max_tokens is too low or missing
        const newMaxTokens =
          typeof originalMaxTokens === "number" && originalMaxTokens > 0 ?
            originalMaxTokens
          : AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS

        consola.info(
          `Retrying with max_completion_tokens instead of max_tokens (${originalMaxTokens} → ${newMaxTokens})`,
        )
        const retryBody = { ...body, max_completion_tokens: newMaxTokens }
        delete retryBody.max_tokens

        consola.debug(
          `[Azure OpenAI] Retry request summary: messages=${Array.isArray(retryBody.messages) ? retryBody.messages.length : 0}, max_completion_tokens=${typeof retryBody.max_completion_tokens === "number" ? retryBody.max_completion_tokens : "unset"}`,
        )

        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(retryBody),
        })
      }

      if (!response.ok) {
        const retryErrorText =
          response === undefined || response === null || response.bodyUsed ?
            errorText
          : await response.text()
        consola.error(
          `[Azure OpenAI] Request failed (${response.status}): ${retryErrorText}`,
        )
        consola.error(`[Azure OpenAI] Request URL: ${url}`)
        consola.error(
          `[Azure OpenAI] Request headers: ${Object.keys(headers).join(", ")}`,
        )
        consola.error(
          `[Azure OpenAI] Final request summary: messages=${Array.isArray(body.messages) ? body.messages.length : 0}, max_tokens=${body.max_tokens}, max_completion_tokens=${body.max_completion_tokens}`,
        )
        throw new HTTPError("Azure OpenAI chat completions failed", response)
      } else {
        consola.info(`[Azure OpenAI] Retry succeeded!`)
      }
    }

    return response
  }

  async createCompletions(payload: Record<string, unknown>): Promise<Response> {
    const tokenData = await this.ensureValidToken()
    const stream = Boolean(payload.stream)
    const model = (payload.model as string | undefined) ?? ""

    const url = buildAzureCompletionsUrl(tokenData, model)
    const headers = getAzureOpenAIHeaders(tokenData, stream)

    // Convert chat format to completions format for Codex
    const completionsPayload = this.convertChatToCompletions(payload)

    consola.info(`📤 Azure OpenAI Codex: ${model} | ${url} | Stream: ${stream}`)
    consola.debug(
      `[Azure OpenAI] Codex request summary: prompt_length=${typeof completionsPayload.prompt === "string" ? completionsPayload.prompt.length : "unknown"}, max_tokens=${completionsPayload.max_tokens}`,
    )

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(completionsPayload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      consola.error(
        `[Azure OpenAI] Codex request failed (${response.status}): ${errorText}`,
      )
      consola.error(`[Azure OpenAI] Request URL: ${url}`)
      consola.error(
        `[Azure OpenAI] Request headers: ${Object.keys(headers).join(", ")}`,
      )
      consola.error(
        `[Azure OpenAI] Request summary: prompt_length=${typeof completionsPayload.prompt === "string" ? completionsPayload.prompt.length : "unknown"}, max_tokens=${completionsPayload.max_tokens}`,
      )
      throw new HTTPError("Azure OpenAI completions failed", response)
    }

    // If it's a streaming response, we need to convert the stream format
    if (stream) {
      return this.convertCompletionsStreamResponse(response, model)
    }

    // For non-streaming, convert the response format
    return this.convertCompletionsResponse(response, model)
  }

  /**
   * Convert chat completions payload to completions payload for Codex models
   */
  private convertChatToCompletions(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const messages =
      (payload.messages as Array<{ role: string; content: string }>) || []

    // Convert messages to a single prompt
    let prompt = ""
    for (const message of messages) {
      switch (message.role) {
        case "system": {
          prompt += `${message.content}\n\n`

          break
        }
        case "user": {
          prompt += message.content

          break
        }
        case "assistant": {
          prompt += `\n${message.content}\n`

          break
        }
        // No default
      }
    }

    // Remove the model field and messages, add prompt
    const { model: _model, messages: _messages, ...rest } = payload

    const completionsPayload = {
      ...rest,
      prompt: prompt.trim(),
    }

    // Ensure proper token limits for Codex
    if (!completionsPayload.max_tokens) {
      completionsPayload.max_tokens = 1000
    }

    // Add stop sequences if not specified
    if (!completionsPayload.stop) {
      completionsPayload.stop = ["\n\n", "```"]
    }

    // Set reasonable defaults for code generation
    if (completionsPayload.temperature === undefined) {
      completionsPayload.temperature = 0.1
    }

    return completionsPayload
  }

  /**
   * Convert completions response to chat completions format for compatibility
   */
  private async convertCompletionsResponse(
    response: Response,
    model: string,
  ): Promise<Response> {
    const json = (await response.json()) as any

    // Convert completions format to chat format
    const chatResponse = {
      id: json.id,
      object: "chat.completion",
      created: json.created || Math.floor(Date.now() / 1000),
      model: model,
      choices:
        json.choices?.map((choice: any, index: number) => ({
          index,
          message: {
            role: "assistant",
            content: choice.text || "",
          },
          finish_reason: choice.finish_reason,
        })) || [],
      usage: json.usage,
    }

    return new Response(JSON.stringify(chatResponse), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  /**
   * Convert completions streaming response to chat completions streaming format
   */
  private convertCompletionsStreamResponse(
    response: Response,
    model: string,
  ): Response {
    // For streaming, we need to transform the SSE format
    const readable = new ReadableStream({
      start(controller) {
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        const buffer = ""

        if (!reader) {
          controller.close()
          return
        }

        const processChunk = async () => {
          try {
            const { done, value } = await reader.read()

            if (done) {
              controller.close()
              return
            }

            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split("\n")

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim()
                if (data === "[DONE]") {
                  controller.enqueue(
                    new TextEncoder().encode("data: [DONE]\n\n"),
                  )
                  continue
                }

                try {
                  const completionChunk = JSON.parse(data)

                  // Convert to chat format
                  const chatChunk = {
                    id: completionChunk.id,
                    object: "chat.completion.chunk",
                    created:
                      completionChunk.created || Math.floor(Date.now() / 1000),
                    model: model,
                    choices:
                      completionChunk.choices?.map(
                        (choice: any, index: number) => ({
                          index,
                          delta: {
                            content: choice.text || "",
                          },
                          finish_reason: choice.finish_reason,
                        }),
                      ) || [],
                  }

                  const convertedLine = `data: ${JSON.stringify(chatChunk)}\n\n`
                  controller.enqueue(new TextEncoder().encode(convertedLine))
                } catch (parseError) {
                  consola.warn(
                    `Failed to parse completions stream chunk: ${parseError}`,
                  )
                }
              }
            }

            processChunk()
          } catch (error) {
            consola.error("Error processing completions stream:", error)
            controller.error(error)
          }
        }

        processChunk()
      },
    })

    return new Response(readable, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      }),
    })
  }

  async createResponses(payload: Record<string, unknown>): Promise<Response> {
    const tokenData = await this.ensureValidToken()
    const stream = Boolean(payload.stream)
    const model = (payload.model as string | undefined) ?? ""

    const url = buildAzureResponsesUrl(tokenData, model)
    const headers = getAzureOpenAIHeaders(tokenData, stream)

    // Check if payload is already in responses format (from CIF adapter) or needs conversion
    let responsesPayload: Record<string, unknown>
    if ("input" in payload && !("messages" in payload)) {
      // Already in responses format from CIF adapter
      responsesPayload = payload
    } else {
      // Convert chat format to responses format for GPT-5.x-codex
      responsesPayload = this.convertChatToResponses(payload)
    }

    consola.info(
      `📤 Azure OpenAI Responses (${this.instanceId}): ${model} | Stream: ${stream}`,
    )

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(responsesPayload),
    })

    if (!response.ok) {
      const errorText = await response
        .clone()
        .text()
        .catch(() => "")
      consola.error(
        `[Azure OpenAI] (${this.instanceId}) Responses request failed (${response.status}): ${errorText}`,
      )
      throw new HTTPError(
        `Azure OpenAI responses failed (${this.instanceId})`,
        response,
      )
    }

    // If it's a streaming response, we need to convert the stream format
    if (stream) {
      return this.convertResponsesStreamResponse(response, model)
    }

    // For non-streaming, convert the response format
    return this.convertResponsesResponse(response, model)
  }

  /**
   * Convert chat completions payload to responses payload for GPT-5.x-codex models
   */
  private convertChatToResponses(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const messages =
      (payload.messages as Array<{
        role: string
        content?: string | Array<{ type: string; text?: string }>
        tool_call_id?: string
        tool_calls?: Array<{
          id?: string
          type?: string
          function?: {
            name?: string
            arguments?: string
          }
        }>
      }>) || []
    const model = payload.model as string

    // Convert messages to response items format
    const input = messages.flatMap((message, index) =>
      this.convertChatMessageToResponsesInput(message, index),
    )

    // Keep the model field for responses API (unlike chat completions)
    const { messages: _messages, ...rest } = payload

    const tools = Array.isArray(payload.tools) ? payload.tools : undefined
    const toolChoice = payload.tool_choice

    const responsesPayload = {
      ...rest,
      model, // Keep model field for responses API
      input,
      generate: true, // Enable generation for responses API
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    }

    // Ensure proper token limits for responses API
    if (responsesPayload.max_tokens) {
      responsesPayload.max_output_tokens = responsesPayload.max_tokens
      delete responsesPayload.max_tokens
    } else if (!responsesPayload.max_output_tokens) {
      responsesPayload.max_output_tokens =
        AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS
    }

    // Remove max_completion_tokens if it exists (not supported in responses API)
    delete responsesPayload.max_completion_tokens

    // Set reasonable defaults for code generation
    if (responsesPayload.temperature === undefined) {
      responsesPayload.temperature = 0.1
    }

    return responsesPayload
  }

  private convertChatMessageToResponsesInput(
    message: {
      role: string
      content?: string | Array<{ type: string; text?: string }>
      tool_call_id?: string
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    },
    index: number,
  ): Array<Record<string, unknown>> {
    const text = this.extractResponsesText(message.content)
    const items: Array<Record<string, unknown>> = []

    if (message.role === "tool") {
      items.push({
        type: "function_call_output",
        call_id: this.convertToAzureToolCallId(message.tool_call_id),
        output: text,
      })
      return items
    }

    if (text.length > 0 || !message.tool_calls?.length) {
      items.push({
        type: "message",
        role: message.role,
        content: [
          {
            type: message.role === "assistant" ? "output_text" : "input_text",
            text,
          },
        ],
        id: `msg_${index}`,
      })
    }

    if (message.role === "assistant" && message.tool_calls?.length) {
      items.push(
        ...message.tool_calls
          .filter(
            (toolCall) =>
              toolCall.type === "function" && toolCall.function?.name,
          )
          .map((toolCall) => {
            const toolCallId = this.convertToAzureToolCallId(toolCall.id)
            return {
              type: "function_call",
              id: toolCallId,
              call_id: toolCallId,
              name: toolCall.function?.name ?? "",
              arguments: this.normalizeToolArguments(
                toolCall.function?.arguments,
              ),
            }
          }),
      )
    }

    return items
  }

  private extractResponsesText(
    content: string | Array<{ type: string; text?: string }> | undefined,
  ): string {
    if (typeof content === "string") {
      return content
    }

    if (!Array.isArray(content)) {
      return ""
    }

    return content
      .filter(
        (block): block is { type: string; text: string } =>
          block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n\n")
  }

  private convertToAzureToolCallId(toolCallId: string | undefined): string {
    if (!toolCallId) {
      return `fc_${Date.now()}`
    }

    if (toolCallId.startsWith("fc")) {
      return toolCallId
    }

    return `fc_${toolCallId.replace(/^[^_]*_?/, "")}`
  }

  private normalizeToolArguments(argumentsValue: string | undefined): string {
    return typeof argumentsValue === "string" && argumentsValue.length > 0 ?
        argumentsValue
      : "{}"
  }

  /**
   * Convert responses response to chat completions format for compatibility
   */
  private async convertResponsesResponse(
    response: Response,
    model: string,
  ): Promise<Response> {
    const json = (await response.json()) as any

    // Debug logging to see the raw response structure
    consola.debug(
      `[Azure OpenAI] (${this.instanceId}) Raw responses API response:`,
      JSON.stringify(json, null, 2),
    )

    const content = extractResponsesOutputText(json)

    // Convert to chat completion format
    const functionCalls =
      Array.isArray(json.output) ?
        json.output.filter((item: any) => item.type === "function_call")
      : []
    const messageContent =
      content.length > 0 ? content
      : functionCalls.length > 0 ? null
      : content

    const chatResponse = {
      id: json.id || `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: json.created_at || json.created || Math.floor(Date.now() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: messageContent,
            ...(functionCalls.length > 0 ?
              {
                tool_calls: functionCalls.map((item: any) => ({
                  id: item.id,
                  type: "function",
                  function: {
                    name: item.name || "",
                    arguments: item.arguments || "{}",
                  },
                })),
              }
            : {}),
          },
          finish_reason: functionCalls.length > 0 ? "tool_calls" : "stop",
        },
      ],
      usage: json.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    }

    return new Response(JSON.stringify(chatResponse), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  /**
   * Convert responses streaming response to chat completions streaming format
   */
  private convertResponsesStreamResponse(
    response: Response,
    model: string,
  ): Response {
    // For streaming, we need to transform the SSE format
    const readable = new ReadableStream({
      start(controller) {
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        if (!reader) {
          controller.close()
          return
        }

        const processChunk = async () => {
          try {
            const { done, value } = await reader.read()

            if (done) {
              buffer += decoder.decode()
              if (buffer.length > 0) {
                const pendingEvents = buffer.split("\n\n")
                for (const rawEvent of pendingEvents) {
                  const line = rawEvent
                    .split("\n")
                    .find((eventLine: string) => eventLine.startsWith("data: "))
                  if (!line) {
                    continue
                  }

                  const data = line.slice(6).trim()
                  if (data === "[DONE]") {
                    controller.enqueue(
                      new TextEncoder().encode("data: [DONE]\n\n"),
                    )
                    continue
                  }

                  try {
                    const responsesChunk = JSON.parse(data)

                    // Convert to chat format
                    const chatChunk = {
                      id: responsesChunk.id || `chatcmpl-${Date.now()}`,
                      object: "chat.completion.chunk",
                      created:
                        responsesChunk.created || Math.floor(Date.now() / 1000),
                      model: model,
                      choices:
                        responsesChunk.choices?.map(
                          (choice: any, index: number) => ({
                            index,
                            delta: {
                              content:
                                choice.delta?.content?.[0]?.text
                                || choice.delta?.text
                                || "",
                            },
                            finish_reason: choice.finish_reason,
                          }),
                        ) || [],
                    }

                    const convertedLine = `data: ${JSON.stringify(chatChunk)}\n\n`
                    controller.enqueue(new TextEncoder().encode(convertedLine))
                  } catch (parseError) {
                    consola.warn(
                      `Failed to parse responses stream chunk: ${parseError}`,
                    )
                  }
                }
              }
              controller.close()
              return
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
                .find((eventLine: string) => eventLine.startsWith("data: "))
              if (!line) {
                continue
              }

              const data = line.slice(6).trim()
              if (data === "[DONE]") {
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
                continue
              }

              try {
                const responsesChunk = JSON.parse(data)

                // Convert to chat format
                const chatChunk = {
                  id: responsesChunk.id || `chatcmpl-${Date.now()}`,
                  object: "chat.completion.chunk",
                  created:
                    responsesChunk.created || Math.floor(Date.now() / 1000),
                  model: model,
                  choices:
                    responsesChunk.choices?.map(
                      (choice: any, index: number) => ({
                        index,
                        delta: {
                          content:
                            choice.delta?.content?.[0]?.text
                            || choice.delta?.text
                            || "",
                        },
                        finish_reason: choice.finish_reason,
                      }),
                    ) || [],
                }

                const convertedLine = `data: ${JSON.stringify(chatChunk)}\n\n`
                controller.enqueue(new TextEncoder().encode(convertedLine))
              } catch (parseError) {
                consola.warn(
                  `Failed to parse responses stream chunk: ${parseError}`,
                )
              }
            }

            processChunk()
          } catch (error) {
            consola.error("Error processing responses stream:", error)
            controller.error(error)
          }
        }

        processChunk()
      },
    })

    return new Response(readable, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      }),
    })
  }

  async createEmbeddings(payload: Record<string, unknown>): Promise<Response> {
    const tokenData = await this.ensureValidToken()
    const model = (payload.model as string | undefined) ?? ""
    const url = buildAzureEmbeddingsUrl(tokenData, model)

    const { model: _model, ...bodyWithoutModel } = payload

    const response = await fetch(url, {
      method: "POST",
      headers: getAzureOpenAIHeaders(tokenData, false),
      body: JSON.stringify(bodyWithoutModel),
    })

    if (!response.ok) {
      throw new HTTPError("Azure OpenAI embeddings failed", response)
    }

    return response
  }

  async getUsage(): Promise<Response> {
    const tokenData = await this.ensureValidToken()
    return new Response(
      JSON.stringify({
        provider: "azure-openai",
        auth_type: tokenData.auth_type,
        endpoint: tokenData.endpoint,
        resource_name: tokenData.resource_name,
        api_version: tokenData.api_version,
      }),
      { headers: { "content-type": "application/json" } },
    )
  }
}
