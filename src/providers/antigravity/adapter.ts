import consola from "consola"

import type {
  CanonicalRequest,
  CanonicalResponse,
  CIFStreamEvent,
  CIFStreamStart,
  CIFContentDelta,
  CIFStreamEnd,
  CIFContentPart,
  CIFMessage,
} from "~/cif/types"
import type { ProviderAdapter } from "~/providers/types"

import type { AntigravityProvider } from "./handlers"

// Antigravity API format types (copied from handlers.ts)
interface AntigravityPart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: {
    id?: string
    name: string
    args: Record<string, unknown>
    thoughtSignature?: string
  }
  functionResponse?: {
    id?: string
    name: string
    response: { result?: unknown }
  }
}

interface AntigravityContent {
  role: "user" | "model"
  parts: Array<AntigravityPart>
}

interface AntigravityTool {
  functionDeclarations: Array<{
    name: string
    description?: string
    parametersJsonSchema?: unknown
  }>
}

interface AntigravityEnvelope {
  model: string
  contents?: Array<AntigravityContent>
  systemInstruction?: AntigravityContent
  generationConfig?: {
    temperature?: number
    topP?: number
    topK?: number
    maxOutputTokens?: number
    stopSequences?: Array<string>
    candidateCount?: number
  }
  tools?: Array<AntigravityTool>
  safetySettings?: Array<unknown>
  requestId: string
}

// Hash function for request ID (copied from handlers.ts)
function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash = Math.trunc(hash)
  }
  return `-${Math.abs(hash).toString(16).padStart(8, "0")}`
}

/**
 * Antigravity Provider Adapter
 * Converts CIF format directly to Antigravity Gemini-style format
 */
export class AntigravityAdapter implements ProviderAdapter {
  readonly provider: AntigravityProvider

  constructor(provider: AntigravityProvider) {
    this.provider = provider
  }

  async execute(request: CanonicalRequest): Promise<CanonicalResponse> {
    consola.debug(
      `[AntigravityAdapter] Executing request for model: ${request.model}`,
    )
    const antigravityPayload = this.canonicalToAntigravity(request)
    consola.debug(
      `[AntigravityAdapter] Converted to Antigravity payload with requestId: ${antigravityPayload.requestId}`,
    )

    const response = await this.provider.createChatCompletions(
      antigravityPayload as unknown as Record<string, unknown>,
    )
    if (!response.ok) {
      const errorMsg = `Antigravity API error: ${response.status} ${response.statusText}`
      consola.error(`[AntigravityAdapter] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    // Antigravity returns newline-delimited JSON, not OpenAI format
    const text = await response.text()
    const lines = text.trim().split("\n")
    const lastLine = lines.at(-1)
    consola.debug(
      `[AntigravityAdapter] Received ${lines.length} lines in response`,
    )

    try {
      const result = JSON.parse(lastLine)
      consola.debug(
        `[AntigravityAdapter] Successfully parsed response, converting to canonical format`,
      )
      return this.antigravityToCanonical(result, request.model)
    } catch (error) {
      consola.error(`[AntigravityAdapter] Failed to parse response: ${error}`)
      throw new Error(`Failed to parse Antigravity response: ${error}`)
    }
  }

  async *executeStream(
    request: CanonicalRequest,
  ): AsyncGenerator<CIFStreamEvent> {
    consola.debug(
      `[AntigravityAdapter] Starting stream execution for model: ${request.model}`,
    )
    const antigravityPayload = this.canonicalToAntigravity(request)
    consola.debug(
      `[AntigravityAdapter] Stream request with requestId: ${antigravityPayload.requestId}`,
    )

    const response = await this.provider.createChatCompletions(
      antigravityPayload as unknown as Record<string, unknown>,
    )
    if (!response.ok) {
      const errorMsg = `Antigravity API error: ${response.status} ${response.statusText}`
      consola.error(`[AntigravityAdapter] Stream ${errorMsg}`)
      throw new Error(errorMsg)
    }

    if (!response.body) {
      consola.error(
        "[AntigravityAdapter] No response body for streaming request",
      )
      throw new Error("No response body for streaming request")
    }

    let hasStarted = false
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
            `[AntigravityAdapter] Stream completed after ${eventCount} events`,
          )
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        const lines = (partialLine + chunk).split("\n")
        partialLine = lines.pop() || ""

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const data = JSON.parse(line)

            if (!hasStarted) {
              hasStarted = true
              consola.debug("[AntigravityAdapter] Emitting stream_start event")
              const startEvent: CIFStreamStart = {
                type: "stream_start",
                id: antigravityPayload.requestId,
                model: request.model,
              }
              yield startEvent
              eventCount++
            }

            // Parse Antigravity streaming format and convert to CIF events
            if (data.candidates?.[0]?.content?.parts) {
              for (const part of data.candidates[0].content.parts) {
                if (part.text) {
                  consola.debug(
                    `[AntigravityAdapter] Processing text delta: ${part.text.length} chars`,
                  )
                  const deltaEvent: CIFContentDelta = {
                    type: "content_delta",
                    index: contentIndex,
                    contentBlock: { type: "text", text: "" },
                    delta: { type: "text_delta", text: part.text },
                  }
                  yield deltaEvent
                  eventCount++
                } else if (part.thought && part.text) {
                  consola.debug(
                    `[AntigravityAdapter] Processing thinking delta: ${part.text.length} chars`,
                  )
                  const deltaEvent: CIFContentDelta = {
                    type: "content_delta",
                    index: contentIndex,
                    contentBlock: { type: "thinking", thinking: "" },
                    delta: { type: "thinking_delta", thinking: part.text },
                  }
                  yield deltaEvent
                  eventCount++
                } else if (part.functionCall) {
                  consola.debug(
                    `[AntigravityAdapter] Processing tool call: ${part.functionCall.name}`,
                  )
                  const deltaEvent: CIFContentDelta = {
                    type: "content_delta",
                    index: contentIndex++,
                    contentBlock: {
                      type: "tool_call",
                      toolCallId: part.functionCall.id || "",
                      toolName: part.functionCall.name,
                      toolArguments: part.functionCall.args || {},
                    },
                    delta: {
                      type: "tool_arguments_delta",
                      partialJson: JSON.stringify(part.functionCall.args || {}),
                    },
                  }
                  yield deltaEvent
                  eventCount++
                }
              }
            }

            // Check for completion
            if (data.candidates?.[0]?.finishReason) {
              const stopReason = this.convertFinishReason(
                data.candidates[0].finishReason,
              )
              consola.debug(
                `[AntigravityAdapter] Stream ending with reason: ${stopReason}`,
              )
              const endEvent: CIFStreamEnd = {
                type: "stream_end",
                stopReason,
                stopSequence: null,
                usage:
                  data.usageMetadata ?
                    {
                      inputTokens: data.usageMetadata.promptTokenCount || 0,
                      outputTokens:
                        data.usageMetadata.candidatesTokenCount || 0,
                    }
                  : undefined,
              }
              yield endEvent
              eventCount++
              return
            }
          } catch (error) {
            consola.warn(
              `[AntigravityAdapter] Failed to parse streaming chunk: ${error}`,
            )
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  remapModel(canonicalModel: string): string {
    // Antigravity model name mapping (from translateModelNameForAntigravity)
    // Antigravity uses hyphen-separated IDs: claude-sonnet-4-6, claude-opus-4-6-thinking
    consola.debug(`[AntigravityAdapter] Remapping model: ${canonicalModel}`)

    let mappedModel: string

    if (canonicalModel.startsWith("claude-opus-4")) {
      mappedModel = "claude-opus-4-6-thinking"
    } else if (canonicalModel.startsWith("claude-opus-")) {
      mappedModel = "claude-opus-4-6-thinking"
    } else if (canonicalModel.startsWith("claude-sonnet-4")) {
      mappedModel = "claude-sonnet-4-6"
    } else if (canonicalModel.startsWith("claude-haiku-4")) {
      mappedModel = "claude-sonnet-4-6"
    } else {
      // Additional mappings for common models
      const modelMap: Record<string, string> = {
        "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
        "claude-3-5-sonnet-20240620": "claude-sonnet-4-6",
        "gpt-4": "claude-sonnet-4-6",
        "gpt-4-turbo": "claude-sonnet-4-6",
        "gpt-3.5-turbo": "claude-haiku-4",
        "o1-preview": "claude-sonnet-4-6",
        "o1-mini": "claude-haiku-4",
      }

      mappedModel = modelMap[canonicalModel] || canonicalModel
    }

    if (mappedModel !== canonicalModel) {
      consola.debug(
        `[AntigravityAdapter] Model remapped: ${canonicalModel} -> ${mappedModel}`,
      )
    }

    return mappedModel
  }

  private canonicalToAntigravity(
    request: CanonicalRequest,
  ): AntigravityEnvelope {
    const model =
      this.remapModel ? this.remapModel(request.model) : request.model

    // Generate request ID
    const reqIdSeed = `${Date.now()}-${Math.random()}`
    const requestId = hashString(reqIdSeed)

    // Handle system instruction
    let systemInstruction: AntigravityContent | undefined
    if (request.systemPrompt) {
      systemInstruction = {
        role: "user",
        parts: [{ text: request.systemPrompt }],
      }
    }

    // Convert messages
    const contents: Array<AntigravityContent> = []
    for (const message of request.messages) {
      if (message.role === "system") {
        // Skip - already handled in systemInstruction
        continue
      }

      contents.push(this.convertMessage(message))
    }

    // Convert tools
    let tools: Array<AntigravityTool> | undefined
    if (request.tools && request.tools.length > 0) {
      tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.parametersSchema,
          })),
        },
      ]
    }

    return {
      model,
      contents,
      systemInstruction,
      generationConfig: {
        temperature: request.temperature,
        topP: request.topP,
        maxOutputTokens: request.maxTokens,
        stopSequences: request.stop,
        candidateCount: 1,
      },
      tools,
      requestId,
    }
  }

  private convertMessage(message: CIFMessage): AntigravityContent {
    const parts: Array<AntigravityPart> = []

    for (const part of message.content) {
      switch (part.type) {
        case "text": {
          parts.push({ text: part.text })
          break
        }
        case "thinking": {
          parts.push({
            text: part.thinking,
            thought: true,
            thoughtSignature:
              part.signature || "skip_thought_signature_validator",
          })
          break
        }
        case "image": {
          if (part.data) {
            parts.push({
              inlineData: {
                mimeType: part.mediaType,
                data: part.data,
              },
            })
          }
          break
        }
        case "tool_call": {
          parts.push({
            functionCall: {
              id: part.toolCallId,
              name: part.toolName,
              args: part.toolArguments,
              thoughtSignature: "skip_thought_signature_validator",
            },
          })
          break
        }
        case "tool_result": {
          parts.push({
            functionResponse: {
              id: part.toolCallId,
              name: part.toolName, // CIF preserves tool name unlike OpenAI
              response: { result: part.content },
            },
          })
          break
        }
      }
    }

    if (parts.length === 0) {
      parts.push({ text: "" })
    }

    return {
      role: message.role === "user" ? "user" : "model",
      parts,
    }
  }

  private antigravityToCanonical(
    result: any,
    originalModel: string,
  ): CanonicalResponse {
    // Handle both direct candidates and nested under response
    const candidates = result.candidates || result.response?.candidates
    const candidate = candidates?.[0]
    if (!candidate) {
      throw new Error("No candidate in Antigravity response")
    }

    const content: Array<CIFContentPart> = []

    if (candidate.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text && !part.thought) {
          content.push({ type: "text", text: part.text })
        } else if (part.text && part.thought) {
          content.push({
            type: "thinking",
            thinking: part.text,
            signature: part.thoughtSignature,
          })
        } else if (part.functionCall) {
          content.push({
            type: "tool_call",
            toolCallId: part.functionCall.id || "",
            toolName: part.functionCall.name,
            toolArguments: part.functionCall.args || {},
          })
        }
      }
    }

    return {
      id: result.requestId || "unknown",
      model: originalModel,
      content,
      stopReason: this.convertFinishReason(candidate.finishReason),
      stopSequence: null,
      usage:
        result.usageMetadata || result.response?.usageMetadata ?
          {
            inputTokens:
              (result.usageMetadata || result.response?.usageMetadata)
                .promptTokenCount || 0,
            outputTokens:
              (result.usageMetadata || result.response?.usageMetadata)
                .candidatesTokenCount || 0,
          }
        : undefined,
    }
  }

  private convertFinishReason(
    reason: string | undefined,
  ): CanonicalResponse["stopReason"] {
    switch (reason) {
      case "STOP": {
        return "end_turn"
      }
      case "MAX_TOKENS": {
        return "max_tokens"
      }
      case "FUNCTION_CALL": {
        return "tool_use"
      }
      case "SAFETY": {
        return "content_filter"
      }
      case "RECITATION": {
        return "content_filter"
      }
      case "OTHER": {
        return "error"
      }
      default: {
        return "end_turn"
      }
    }
  }
}
