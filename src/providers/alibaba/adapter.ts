import consola from "consola"

import type {
  CanonicalRequest,
  CanonicalResponse,
  CIFStreamEvent,
  CIFStreamStart,
  CIFContentDelta,
  CIFStreamEnd,
} from "~/cif/types"
import type { ProviderAdapter } from "~/providers/types"
import type {
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "~/services/copilot/create-chat-completions"

import { canonicalRequestToChatCompletionsPayload } from "~/serialization/to-openai-payload"

import type { AlibabaProvider } from "./handlers"

/**
 * Alibaba Provider Adapter
 * Uses OpenAI format passthrough with Alibaba-specific model mapping
 */
export class AlibabaAdapter implements ProviderAdapter {
  readonly provider: AlibabaProvider

  constructor(provider: AlibabaProvider) {
    this.provider = provider
  }

  async execute(request: CanonicalRequest): Promise<CanonicalResponse> {
    consola.debug(
      `[AlibabaAdapter] Executing request for model: ${request.model}`,
    )
    const payload = canonicalRequestToChatCompletionsPayload(request)

    // Apply model remapping if needed
    if (this.remapModel) {
      const originalModel = payload.model
      payload.model = this.remapModel(request.model)
      if (payload.model !== originalModel) {
        consola.debug(
          `[AlibabaAdapter] Model remapped: ${originalModel} -> ${payload.model}`,
        )
      }
    }

    consola.debug(
      `[AlibabaAdapter] Sending request to Alibaba with model: ${payload.model}`,
    )
    const response = await this.provider.createChatCompletions(
      payload as Record<string, unknown>,
    )
    if (!response.ok) {
      const errorMsg = `Alibaba API error: ${response.status} ${response.statusText}`
      consola.error(`[AlibabaAdapter] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    const json = (await response.json()) as ChatCompletionResponse
    consola.debug(
      `[AlibabaAdapter] Received response with choice: ${json.choices[0]?.message?.content ? "has content" : "no content"}`,
    )

    return {
      id: json.id,
      model: request.model, // Return original model name
      content: this.convertOpenAIContent(json.choices[0]?.message),
      stopReason: this.convertFinishReason(json.choices[0]?.finish_reason),
      stopSequence: null, // OpenAI doesn't provide stop sequences
      usage:
        json.usage ?
          {
            inputTokens: json.usage.prompt_tokens,
            outputTokens: json.usage.completion_tokens,
            cacheReadInputTokens:
              json.usage.prompt_tokens_details?.cached_tokens,
          }
        : undefined,
    }
  }

  async *executeStream(
    request: CanonicalRequest,
  ): AsyncGenerator<CIFStreamEvent> {
    const payload = canonicalRequestToChatCompletionsPayload(request)
    payload.stream = true

    // Apply model remapping if needed
    if (this.remapModel) {
      payload.model = this.remapModel(request.model)
    }

    const response = await this.provider.createChatCompletions(
      payload as Record<string, unknown>,
    )
    if (!response.ok) {
      throw new Error(
        `Alibaba API error: ${response.status} ${response.statusText}`,
      )
    }

    if (!response.body) {
      throw new Error("No response body for streaming request")
    }

    let streamId: string | undefined
    let contentIndex = 0
    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim()
            if (data === "[DONE]") {
              return
            }

            try {
              const parsed = JSON.parse(data) as ChatCompletionChunk

              if (!streamId && parsed.id) {
                streamId = parsed.id
                const startEvent: CIFStreamStart = {
                  type: "stream_start",
                  id: parsed.id,
                  model: request.model, // Return original model name
                }
                yield startEvent
              }

              const choice = parsed.choices?.[0]
              if (choice?.delta) {
                // Handle content delta
                if (choice.delta.content) {
                  const deltaEvent: CIFContentDelta = {
                    type: "content_delta",
                    index: contentIndex,
                    contentBlock: { type: "text", text: "" },
                    delta: { type: "text_delta", text: choice.delta.content },
                  }
                  yield deltaEvent
                }

                // Handle tool calls
                if (choice.delta.tool_calls) {
                  for (const toolCall of choice.delta.tool_calls) {
                    if (toolCall.function?.name) {
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
                      yield deltaEvent
                    } else if (toolCall.function?.arguments) {
                      // Tool call arguments delta
                      const deltaEvent: CIFContentDelta = {
                        type: "content_delta",
                        index: contentIndex - 1, // Use previous index
                        delta: {
                          type: "tool_arguments_delta",
                          partialJson: toolCall.function.arguments,
                        },
                      }
                      yield deltaEvent
                    }
                  }
                }

                // Handle finish reason
                if (choice.finish_reason) {
                  const endEvent: CIFStreamEnd = {
                    type: "stream_end",
                    stopReason: this.convertFinishReason(choice.finish_reason),
                    stopSequence: null,
                    usage:
                      parsed.usage ?
                        {
                          inputTokens: parsed.usage.prompt_tokens || 0,
                          outputTokens: parsed.usage.completion_tokens || 0,
                        }
                      : undefined,
                  }
                  yield endEvent
                  return
                }
              }
            } catch (error) {
              consola.warn("Failed to parse SSE chunk:", error)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  remapModel(canonicalModel: string): string {
    consola.debug(`[AlibabaAdapter] Remapping model: ${canonicalModel}`)

    // Alibaba model name mapping (from translateModelNameForAlibaba)
    if (!canonicalModel.startsWith("claude-")) {
      consola.debug(
        `[AlibabaAdapter] Non-Claude model, returning as-is: ${canonicalModel}`,
      )
      return canonicalModel
    }

    const isHaiku = canonicalModel.includes("haiku")
    const isOpus = canonicalModel.includes("opus")
    const isSonnet = canonicalModel.includes("sonnet")

    let mappedModel: string | null = null

    if (isHaiku) {
      consola.debug(
        `[AlibabaAdapter] Detected Claude Haiku variant, finding Alibaba equivalent`,
      )
      mappedModel = this.resolvePreferredModel(
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
      )
    } else if (isOpus) {
      consola.debug(
        `[AlibabaAdapter] Detected Claude Opus variant, finding Alibaba equivalent`,
      )
      mappedModel = this.resolvePreferredModel(
        [
          "qwen3-max",
          "qwen3-max-preview",
          "qwen-max-latest",
          "qwen-max",
          "glm-5",
        ],
        [/^qwen3-max(?:-|$)/, /^qwen-max(?:-|$)/, /^glm-5(?:-|$)/],
      )
    } else if (isSonnet) {
      consola.debug(
        `[AlibabaAdapter] Detected Claude Sonnet variant, finding Alibaba equivalent`,
      )
      mappedModel = this.resolvePreferredModel(
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
      )
    }

    const finalModel = mappedModel ?? canonicalModel

    if (finalModel !== canonicalModel) {
      consola.debug(
        `[AlibabaAdapter] Model remapped: ${canonicalModel} -> ${finalModel}`,
      )
    }

    return finalModel
  }

  private getAvailableModelIds(): Array<string> {
    // Note: In the original code, this relied on global state.models
    // For now, we'll return a common set of Alibaba models
    // TODO: This could be enhanced to query actual available models
    return [
      "qwen3-coder-flash",
      "qwen3.5-flash",
      "qwen-flash",
      "qwen-turbo-latest",
      "qwen-turbo",
      "qwen3-max",
      "qwen3-max-preview",
      "qwen-max-latest",
      "qwen-max",
      "qwen3.6-plus",
      "qwen3-coder-plus",
      "qwen3-coder-next",
      "qwen3.5-plus",
      "qwen-plus-latest",
      "qwen-plus",
      "glm-5",
    ]
  }

  private resolvePreferredModel(
    exactIds: Array<string>,
    patterns: Array<RegExp>,
  ): string | null {
    const availableModelIds = this.getAvailableModelIds()

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
