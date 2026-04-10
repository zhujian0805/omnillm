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

import type { GitHubCopilotProvider } from "./handlers"

/**
 * GitHub Copilot Provider Adapter
 * Uses OpenAI format with GitHub-specific headers and retry logic
 */
export class GitHubCopilotAdapter implements ProviderAdapter {
  readonly provider: GitHubCopilotProvider

  constructor(provider: GitHubCopilotProvider) {
    this.provider = provider
  }

  async execute(request: CanonicalRequest): Promise<CanonicalResponse> {
    consola.debug(
      `[GitHubCopilotAdapter] Executing request for model: ${request.model}`,
    )
    const payload = canonicalRequestToChatCompletionsPayload(request)

    // Apply model remapping if needed
    if (this.remapModel) {
      const originalModel = payload.model
      payload.model = this.remapModel(request.model)
      if (payload.model !== originalModel) {
        consola.debug(
          `[GitHubCopilotAdapter] Model remapped: ${originalModel} -> ${payload.model}`,
        )
      }
    }

    // GitHub Copilot specific: Add X-Initiator header logic
    // This is handled in the provider's createChatCompletions method

    // GitHub Copilot specific: Handle max_tokens retry logic
    consola.debug(
      `[GitHubCopilotAdapter] Sending request to GitHub Copilot with model: ${payload.model}`,
    )
    let response = await this.provider.createChatCompletions(
      payload as unknown as Record<string, unknown>,
    )

    // Handle max_tokens retry logic for GPT models
    if (!response.ok && payload.model?.includes("gpt") && payload.max_tokens) {
      const errorText = await response.text()
      if (
        errorText.includes("max_tokens")
        || errorText.includes("maximum context")
      ) {
        consola.warn(
          `[GitHubCopilotAdapter] Retrying with reduced max_tokens: ${Math.floor(payload.max_tokens * 0.8)}`,
        )
        payload.max_tokens = Math.floor(payload.max_tokens * 0.8)
        response = await this.provider.createChatCompletions(
          payload as Record<string, unknown>,
        )
      }
    }

    if (!response.ok) {
      const errorMsg = `GitHub Copilot API error: ${response.status} ${response.statusText}`
      consola.error(`[GitHubCopilotAdapter] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    const json = (await response.json()) as ChatCompletionResponse
    consola.debug(
      `[GitHubCopilotAdapter] Received response with choice: ${json.choices[0]?.message?.content ? "has content" : "no content"}`,
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
    consola.debug(
      `[GitHubCopilotAdapter] Starting stream execution for model: ${request.model}`,
    )
    const payload = canonicalRequestToChatCompletionsPayload(request)
    payload.stream = true

    // Apply model remapping if needed
    if (this.remapModel) {
      const originalModel = payload.model
      payload.model = this.remapModel(request.model)
      if (payload.model !== originalModel) {
        consola.debug(
          `[GitHubCopilotAdapter] Stream model remapped: ${originalModel} -> ${payload.model}`,
        )
      }
    }

    const response = await this.provider.createChatCompletions(
      payload as Record<string, unknown>,
    )
    if (!response.ok) {
      const errorMsg = `GitHub Copilot API error: ${response.status} ${response.statusText}`
      consola.error(`[GitHubCopilotAdapter] Stream ${errorMsg}`)
      throw new Error(errorMsg)
    }

    if (!response.body) {
      consola.error(
        "[GitHubCopilotAdapter] No response body for streaming request",
      )
      throw new Error("No response body for streaming request")
    }

    let streamId: string | undefined
    let contentIndex = 0
    let eventCount = 0
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let partialLine = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          consola.debug(
            `[GitHubCopilotAdapter] Stream completed after ${eventCount} events`,
          )
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        const lines = (partialLine + chunk).split("\n")
        partialLine = lines.pop() ?? ""

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim()
            if (data === "[DONE]") {
              consola.debug("[GitHubCopilotAdapter] Received [DONE] marker")
              return
            }

            try {
              const parsed = JSON.parse(data) as ChatCompletionChunk

              if (!streamId && parsed.id) {
                streamId = parsed.id
                consola.debug(
                  `[GitHubCopilotAdapter] Emitting stream_start with id: ${parsed.id}`,
                )
                const startEvent: CIFStreamStart = {
                  type: "stream_start",
                  id: parsed.id,
                  model: request.model, // Return original model name
                }
                yield startEvent
                eventCount++
              }

              const choice = parsed.choices?.[0]
              if (choice?.delta) {
                // Handle content delta
                if (choice.delta.content) {
                  consola.debug(
                    `[GitHubCopilotAdapter] Processing text delta: ${choice.delta.content.length} chars`,
                  )
                  const deltaEvent: CIFContentDelta = {
                    type: "content_delta",
                    index: contentIndex,
                    contentBlock: { type: "text", text: "" },
                    delta: { type: "text_delta", text: choice.delta.content },
                  }
                  yield deltaEvent
                  eventCount++
                }

                // Handle tool calls
                if (choice.delta.tool_calls) {
                  for (const toolCall of choice.delta.tool_calls) {
                    if (toolCall.function?.name) {
                      consola.debug(
                        `[GitHubCopilotAdapter] Processing new tool call: ${toolCall.function.name}`,
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
                      yield deltaEvent
                      eventCount++
                    } else if (toolCall.function?.arguments) {
                      consola.debug(
                        `[GitHubCopilotAdapter] Processing tool arguments delta`,
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
                      yield deltaEvent
                      eventCount++
                    }
                  }
                }

                // Handle finish reason
                if (choice.finish_reason) {
                  const stopReason = this.convertFinishReason(
                    choice.finish_reason,
                  )
                  consola.debug(
                    `[GitHubCopilotAdapter] Stream ending with reason: ${stopReason}`,
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
                  yield endEvent
                  eventCount++
                  return
                }
              }
            } catch (error) {
              consola.warn(
                `[GitHubCopilotAdapter] Failed to parse SSE chunk: ${error}`,
              )
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  remapModel(canonicalModel: string): string {
    consola.debug(`[GitHubCopilotAdapter] Remapping model: ${canonicalModel}`)

    let mappedModel: string

    // GitHub Copilot model name mapping (from translateModelNameForCopilot)
    // Handle claude-opus variants
    if (canonicalModel.startsWith("claude-opus-4.6")) {
      mappedModel = "claude-opus-4.6"
    } else if (canonicalModel.startsWith("claude-opus-4-")) {
      mappedModel = "claude-opus-4.6"
    } else if (canonicalModel.startsWith("claude-opus-")) {
      mappedModel = "claude-opus-4.5"
    }
    // Handle claude-sonnet variants
    else if (canonicalModel.startsWith("claude-sonnet-4.6")) {
      mappedModel = "claude-sonnet-4.6"
    } else if (canonicalModel.startsWith("claude-sonnet-4-")) {
      mappedModel = "claude-sonnet-4.6"
    } else if (canonicalModel.startsWith("claude-sonnet-4.5")) {
      mappedModel = "claude-sonnet-4.5"
    } else if (canonicalModel.startsWith("claude-sonnet-4")) {
      mappedModel = "claude-sonnet-4"
    }
    // Handle claude-haiku variants
    else if (canonicalModel.startsWith("claude-haiku-4")) {
      mappedModel = "claude-haiku-4.5"
    } else {
      // Additional mappings for other models
      const modelMap: Record<string, string> = {
        "claude-3-5-sonnet-20241022": "claude-3.5-sonnet",
        "claude-3-5-sonnet-20240620": "claude-3.5-sonnet",
        "gpt-5.3-codex": "gpt-4o", // Antigravity model fallback
        "o1-preview": "o1-preview",
        "o1-mini": "o1-mini",
        // Handle specific Claude model variants with date suffixes
        "claude-haiku-4-5-20251001": "claude-haiku-4.5",
        "claude-sonnet-4-6-20241022": "claude-sonnet-4.6",
        "claude-opus-4-6-20241022": "claude-opus-4.6",
      }

      mappedModel = modelMap[canonicalModel] || canonicalModel
    }

    if (mappedModel !== canonicalModel) {
      consola.debug(
        `[GitHubCopilotAdapter] Model remapped: ${canonicalModel} -> ${mappedModel}`,
      )
    }

    return mappedModel
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
