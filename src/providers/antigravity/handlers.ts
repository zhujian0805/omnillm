import consola from "consola"

import type { Provider } from "~/providers/types"
import type { ModelsResponse } from "~/services/copilot/get-models"

import { HTTPError } from "~/lib/error"
import { PATHS } from "~/lib/paths"
import { providerRegistry } from "~/providers/registry"

import { AntigravityAdapter } from "./adapter"
import {
  getAntigravityBaseUrl,
  getAntigravityHeaders,
  getAntigravityModelsPath,
  getAntigravityStreamPath,
} from "./api"
import {
  setupAntigravityAuth,
  readAntigravityToken,
  refreshAntigravityToken,
  isTokenExpiringSoon,
  fetchProjectID,
  writeAntigravityToken,
  type AntigravityTokenData,
} from "./auth"
import { ANTIGRAVITY_USER_AGENT } from "./constants"

// ---------------------------------------------------------------------------
// Antigravity API format types
// The request uses a custom envelope wrapping Gemini-style content
// ---------------------------------------------------------------------------

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

interface AntigravityFunctionDeclaration {
  name: string
  description?: string
  parameters?: unknown
}

interface AntigravityTool {
  functionDeclarations?: Array<AntigravityFunctionDeclaration>
}

interface AntigravityGenerationConfig {
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: Array<string>
}

interface AntigravityInnerRequest {
  sessionId?: string
  contents: Array<AntigravityContent>
  systemInstruction?: AntigravityContent
  tools?: Array<AntigravityTool>
  toolConfig?: {
    functionCallingConfig: {
      mode: string
      allowedFunctionNames?: Array<string>
    }
  }
  generationConfig?: AntigravityGenerationConfig
}

interface AntigravityEnvelope {
  model: string
  userAgent: string
  requestType: "agent"
  project?: string
  requestId: string
  request: AntigravityInnerRequest
}

interface AntigravityCandidate {
  content: AntigravityContent
  finishReason?: string
  index?: number
}

interface AntigravityUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

interface AntigravityInnerResponse {
  candidates?: Array<AntigravityCandidate>
  usageMetadata?: AntigravityUsageMetadata
  modelVersion?: string
}

// Each streaming line is: { response: AntigravityInnerResponse, traceId?: string }
// Non-streaming is the same shape as a single object
interface AntigravityStreamLine {
  response?: AntigravityInnerResponse
  traceId?: string
}

function extractAntigravitySSEData(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(":")) return null
  if (!trimmed.startsWith("data:")) return trimmed

  const data = trimmed.slice(5).trim()
  return data === "[DONE]" ? null : data
}

function parseAntigravityStreamLine(
  line: string,
): AntigravityStreamLine | null {
  const data = extractAntigravitySSEData(line)
  if (!data) return null

  try {
    return JSON.parse(data) as AntigravityStreamLine
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// OpenAI format types (minimal subset for return)
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: string
  content: string | null
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
}

interface OpenAIChoice {
  index: number
  message: OpenAIMessage
  finish_reason: string
}

interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

interface OpenAIChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<OpenAIChoice>
  usage: OpenAIUsage
}

interface OpenAIDelta {
  role?: string
  content?: string | null
  tool_calls?: Array<{
    index: number
    id?: string
    type?: "function"
    function?: { name?: string; arguments?: string }
  }>
}

interface OpenAIChunkChoice {
  index: number
  delta: OpenAIDelta
  finish_reason: string | null
}

interface OpenAIChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<OpenAIChunkChoice>
  usage?: OpenAIUsage
}

// ---------------------------------------------------------------------------
// OpenAI → Antigravity payload translation
// ---------------------------------------------------------------------------

type OpenAIRole = "system" | "user" | "assistant" | "tool"

interface OpenAIInputMessage {
  role: OpenAIRole
  content?:
    | string
    | Array<{ type: string; text?: string; data?: string; media_type?: string }>
    | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
}

function openAIMessageContentToText(
  content: OpenAIInputMessage["content"],
): string {
  if (!content) return ""
  if (typeof content === "string") return content
  return content
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")
}

function generateSessionId(messages: Array<OpenAIInputMessage>): string {
  const firstUserMsg = messages.find((m) => m.role === "user")
  const text = openAIMessageContentToText(firstUserMsg?.content) || "session"
  // Simple stable hash
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash = Math.trunc(hash)
  }
  return `-${Math.abs(hash).toString(16).padStart(8, "0")}`
}

/**
 * @deprecated This function is deprecated in favor of AntigravityAdapter which converts
 * directly from CanonicalRequest to Antigravity format, avoiding the OpenAI intermediate step.
 * This function is kept for backward compatibility with the legacy translation path.
 */
function translateOpenAIToAntigravity(
  payload: Record<string, unknown>,
  projectId: string,
): AntigravityEnvelope {
  const messages = (payload.messages ?? []) as Array<OpenAIInputMessage>
  const model = (payload.model as string | undefined) ?? "claude-sonnet-4-6"

  // Extract system messages
  const systemMessages = messages.filter((m) => m.role === "system")
  const nonSystemMessages = messages.filter((m) => m.role !== "system")

  let systemInstruction: AntigravityContent | undefined
  if (systemMessages.length > 0) {
    const systemText = systemMessages
      .map((m) => openAIMessageContentToText(m.content))
      .join("\n\n")
    systemInstruction = { role: "user", parts: [{ text: systemText }] }
  }

  // Build contents from non-system messages
  const contents: Array<AntigravityContent> = []
  for (const msg of nonSystemMessages) {
    if (msg.role === "assistant") {
      const parts: Array<AntigravityPart> = []
      const textContent = openAIMessageContentToText(msg.content)
      if (textContent) parts.push({ text: textContent })
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>
          } catch {
            // ignore
          }
          parts.push({
            functionCall: {
              id: tc.id,
              name: tc.function.name,
              args,
              thoughtSignature: "skip_thought_signature_validator",
            },
          })
        }
      }
      if (parts.length === 0) parts.push({ text: "" })
      contents.push({ role: "model", parts })
    } else if (msg.role === "tool") {
      const responseText = openAIMessageContentToText(msg.content)
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              id: msg.tool_call_id,
              name: msg.tool_call_id ?? "unknown",
              response: { result: responseText },
            },
          },
        ],
      })
    } else {
      // user — handle text and images
      const content = msg.content
      if (Array.isArray(content)) {
        const parts: Array<AntigravityPart> = []
        for (const part of content) {
          if (part.type === "text") {
            parts.push({ text: part.text ?? "" })
          } else if (part.type === "image_url") {
            // image_url with data URI
            const url =
              (part as { type: string; image_url?: { url?: string } }).image_url
                ?.url ?? ""
            const match = /^data:([^;]+);base64,(.+)$/.exec(url)
            if (match) {
              parts.push({ inlineData: { mimeType: match[1], data: match[2] } })
            }
          }
        }
        contents.push({ role: "user", parts })
      } else {
        const text = openAIMessageContentToText(content)
        contents.push({ role: "user", parts: [{ text }] })
      }
    }
  }

  // Translate tools — use parametersJsonSchema
  let tools: Array<AntigravityTool> | undefined
  const openAITools = payload.tools as
    | Array<{
        type: string
        function: { name: string; description?: string; parameters?: unknown }
      }>
    | undefined
  if (openAITools && openAITools.length > 0) {
    tools = [
      {
        functionDeclarations: openAITools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: sanitizeSchema(t.function.parameters),
        })),
      },
    ]
  }

  // Tool config
  let toolConfig: AntigravityInnerRequest["toolConfig"] | undefined
  if (tools) {
    const toolChoice = payload.tool_choice
    if (toolChoice === "none") {
      toolConfig = { functionCallingConfig: { mode: "NONE" } }
    } else if (toolChoice === "required") {
      toolConfig = { functionCallingConfig: { mode: "ANY" } }
    } else if (toolChoice && typeof toolChoice === "object") {
      const tc = toolChoice as { type?: string; function?: { name?: string } }
      toolConfig = {
        functionCallingConfig: {
          mode: "VALIDATED",
          ...(tc.function?.name && {
            allowedFunctionNames: [tc.function.name],
          }),
        },
      }
    } else {
      toolConfig = { functionCallingConfig: { mode: "VALIDATED" } }
    }
  }

  // Generation config
  const generationConfig: AntigravityGenerationConfig = {}
  if (payload.max_tokens != null)
    generationConfig.maxOutputTokens = payload.max_tokens as number
  if (payload.temperature != null)
    generationConfig.temperature = payload.temperature as number
  if (payload.top_p != null) generationConfig.topP = payload.top_p as number
  if (payload.stop != null) {
    const stop = payload.stop
    generationConfig.stopSequences =
      Array.isArray(stop) ? (stop as Array<string>) : [stop as string]
  }

  const requestId = `agent-${crypto.randomUUID()}`

  const innerRequest: AntigravityInnerRequest = {
    sessionId: generateSessionId(messages),
    contents,
    ...(systemInstruction && { systemInstruction }),
    ...(tools && { tools }),
    ...(toolConfig && { toolConfig }),
    ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
  }

  return {
    model,
    userAgent: "antigravity",
    requestType: "agent",
    ...(projectId ? { project: projectId } : {}),
    requestId,
    request: innerRequest,
  }
}

/** Remove non-standard JSON Schema fields that Antigravity rejects */
function sanitizeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema
  if (Array.isArray(schema)) return schema.map(sanitizeSchema)
  const obj = schema as Record<string, unknown>
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
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (banned.has(k)) continue
    result[k] = sanitizeSchema(v)
  }
  return result
}

// ---------------------------------------------------------------------------
// Antigravity → OpenAI response translation
// ---------------------------------------------------------------------------

function antigravityFinishReasonToOpenAI(reason?: string): string {
  switch (reason?.toUpperCase()) {
    case "STOP": {
      return "stop"
    }
    case "MAX_TOKENS": {
      return "length"
    }
    case "SAFETY": {
      return "content_filter"
    }
    case "FUNCTION_CALL":
    case "TOOL_CALLS": {
      return "tool_calls"
    }
    default: {
      return "stop"
    }
  }
}

function antigravityResponseToOpenAI(
  inner: AntigravityInnerResponse,
  model: string,
  requestId: string,
): OpenAIChatCompletionResponse {
  const candidates = inner.candidates ?? []
  const choices: Array<OpenAIChoice> = candidates.map((cand, idx) => {
    const parts = cand.content?.parts ?? []
    const textParts = parts.filter((p) => p.text != null && !p.thought)
    const funcParts = parts.filter((p) => p.functionCall != null)

    const textContent = textParts.map((p) => p.text).join("") || null

    let toolCalls: OpenAIMessage["tool_calls"] | undefined
    if (funcParts.length > 0) {
      toolCalls = funcParts.map((p, i) => ({
        id: p.functionCall!.id ?? `call_${requestId}_${i}`,
        type: "function" as const,
        function: {
          name: p.functionCall!.name,
          arguments: JSON.stringify(p.functionCall!.args),
        },
      }))
    }

    return {
      index: idx,
      message: {
        role: "assistant",
        content: textContent,
        ...(toolCalls && { tool_calls: toolCalls }),
      },
      finish_reason: antigravityFinishReasonToOpenAI(cand.finishReason),
    }
  })

  const usage = inner.usageMetadata ?? {}
  const promptTokens = usage.promptTokenCount ?? 0
  const completionTokens = usage.candidatesTokenCount ?? 0

  return {
    id: requestId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: inner.modelVersion ?? model,
    choices,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

function antigravityStreamLineToOpenAIChunks(
  inner: AntigravityInnerResponse,
  model: string,
  requestId: string,
): Array<OpenAIChatCompletionChunk> {
  const chunks: Array<OpenAIChatCompletionChunk> = []
  const candidates = inner.candidates ?? []
  const created = Math.floor(Date.now() / 1000)

  for (const cand of candidates) {
    const parts = cand.content?.parts ?? []
    const textParts = parts.filter((p) => p.text != null && !p.thought)
    const funcParts = parts.filter((p) => p.functionCall != null)
    const isLast =
      cand.finishReason != null
      && cand.finishReason !== "FINISH_REASON_UNSPECIFIED"
      && cand.finishReason !== "UNKNOWN"

    if (textParts.length > 0) {
      const text = textParts.map((p) => p.text).join("")
      chunks.push({
        id: requestId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      })
    }

    if (funcParts.length > 0) {
      for (const [i, p] of funcParts.entries()) {
        chunks.push({
          id: requestId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: i,
                    id: p.functionCall!.id ?? `call_${requestId}_${i}`,
                    type: "function",
                    function: {
                      name: p.functionCall!.name,
                      arguments: JSON.stringify(p.functionCall!.args),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })
      }
    }

    if (isLast) {
      const usage = inner.usageMetadata ?? {}
      const promptTokens = usage.promptTokenCount ?? 0
      const completionTokens = usage.candidatesTokenCount ?? 0
      chunks.push({
        id: requestId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: antigravityFinishReasonToOpenAI(cand.finishReason),
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      })
    }
  }

  return chunks
}

export class AntigravityProvider implements Provider {
  id = "antigravity" as const
  instanceId: string
  name: string

  private tokenData: AntigravityTokenData | null = null

  // CIF Adapter
  readonly adapter = new AntigravityAdapter(this)

  constructor(instanceId: string) {
    this.instanceId = instanceId
    this.name = "Antigravity"
  }

  async setupAuth(options?: {
    force?: boolean
    clientId?: string
    clientSecret?: string
  }): Promise<void> {
    await setupAntigravityAuth(this.instanceId, options)
    this.tokenData = await readAntigravityToken(this.instanceId)
    if (!this.tokenData)
      throw new Error("Antigravity token not found after auth")
    if (this.tokenData.email) {
      await this.renameInstance(this.tokenData.email)
    }
  }

  /** Rename this instance to a meaningful ID based on identity metadata.
   *  Moves the token file and updates instanceId + name. */
  private async renameInstance(email: string): Promise<void> {
    const sanitized = email.toLowerCase().replaceAll(/[^a-z0-9._-]/g, "_")
    const newInstanceId = `antigravity-${sanitized}`
    const oldInstanceId = this.instanceId
    if (newInstanceId === oldInstanceId) return

    const oldPath = PATHS.getInstanceTokenPath(oldInstanceId)
    const oldFile = Bun.file(oldPath)
    if (await oldFile.exists()) {
      await writeAntigravityToken(this.tokenData!, newInstanceId)
      await Bun.$`rm -f ${oldPath}`.quiet()
    }

    this.instanceId = newInstanceId
    this.name = `Antigravity (${email})`
    await providerRegistry.rename(oldInstanceId, newInstanceId)
  }

  getToken(): string {
    if (!this.tokenData)
      throw new Error(
        "Antigravity not authenticated. Run: omnimodel auth antigravity",
      )
    return this.tokenData.access_token
  }

  async refreshToken(): Promise<void> {
    if (!this.tokenData) throw new Error("No token data to refresh")
    this.tokenData = await refreshAntigravityToken(
      this.tokenData,
      this.instanceId,
    )
  }

  private async ensureValidToken(): Promise<AntigravityTokenData> {
    if (!this.tokenData) {
      this.tokenData = await readAntigravityToken(this.instanceId)
    }
    if (!this.tokenData) {
      throw new Error(
        "Antigravity not authenticated. Run: omnimodel auth antigravity",
      )
    }
    if (isTokenExpiringSoon(this.tokenData)) {
      consola.debug("Antigravity: refreshing token...")
      this.tokenData = await refreshAntigravityToken(
        this.tokenData,
        this.instanceId,
      )
    }
    // Lazily fetch project_id if missing (only warn for active providers)
    if (!this.tokenData.project_id) {
      consola.debug("Antigravity: fetching project ID...")
      const projectId = await fetchProjectID(this.tokenData.access_token).catch(
        () => "",
      )
      if (projectId) {
        this.tokenData = { ...this.tokenData, project_id: projectId }
        await writeAntigravityToken(this.tokenData, this.instanceId)
        consola.debug(`Antigravity: project ID set to ${projectId}`)
      } else {
        // Only warn for active providers to avoid spam during admin API calls
        const { providerRegistry } = await import("~/providers/registry")
        const isActive = providerRegistry.isActiveProvider(this.instanceId)
        if (isActive) {
          consola.warn(
            "Antigravity: could not fetch project ID — requests may fail. Try re-running auth.",
          )
        } else {
          consola.debug(
            `Antigravity (${this.instanceId}): project ID not available (provider inactive)`,
          )
        }
      }
    }
    return this.tokenData
  }

  getBaseUrl(): string {
    return getAntigravityBaseUrl()
  }

  getHeaders(): Record<string, string> {
    if (!this.tokenData) throw new Error("Antigravity not authenticated")
    return getAntigravityHeaders(this.tokenData.access_token)
  }

  async getModels(): Promise<ModelsResponse> {
    const tokenData = await this.ensureValidToken()

    const body =
      tokenData.project_id ?
        JSON.stringify({ project: tokenData.project_id })
      : JSON.stringify({})

    // Try each base URL in order
    const baseURLs = [
      "https://cloudcode-pa.googleapis.com",
      "https://daily-cloudcode-pa.googleapis.com",
    ]

    for (const baseURL of baseURLs) {
      const url = `${baseURL}${getAntigravityModelsPath()}`
      consola.debug(`Antigravity: fetching models from ${url}`)
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenData.access_token}`,
            "User-Agent": ANTIGRAVITY_USER_AGENT,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        })

        if (!response.ok) {
          const errText = await response.text().catch(() => "")
          consola.debug(
            `Antigravity models fetch failed at ${baseURL}: ${response.status} ${errText}`,
          )
          continue
        }

        const raw = (await response.json()) as {
          models?: Record<
            string,
            {
              displayName?: string
              maxTokens?: number
              maxOutputTokens?: number
            }
          >
        }
        const modelsMap = raw.models ?? {}
        const models = Object.entries(modelsMap).map(([id, m]) => ({
          capabilities: {
            family: "antigravity",
            limits: {
              max_context_window_tokens: m.maxTokens ?? 200_000,
              max_output_tokens: m.maxOutputTokens ?? 65_536,
            },
            object: "model_capabilities",
            supports: { tool_calls: true },
            tokenizer: "cl100k_base",
            type: "chat",
          },
          id,
          model_picker_enabled: true,
          name: m.displayName ?? id,
          object: "model",
          preview: false,
          vendor: "google",
          version: "1",
        }))

        consola.debug(`Antigravity: fetched ${models.length} models`)
        return { data: models, object: "list" }
      } catch (err) {
        consola.debug(`Antigravity models error at ${baseURL}:`, err)
      }
    }

    throw new Error("Failed to fetch Antigravity models from all endpoints")
  }

  async createChatCompletions(
    payload: Record<string, unknown>,
  ): Promise<Response> {
    const tokenData = await this.ensureValidToken()
    const stream = Boolean(payload.stream)
    const model = (payload.model as string | undefined) ?? "claude-sonnet-4-6"

    // Always use streaming path (Antigravity uses SSE for Claude models)
    const path = `${getAntigravityStreamPath()}?alt=sse`
    const url = `${getAntigravityBaseUrl()}${path}`
    const headers = getAntigravityHeaders(tokenData.access_token)

    consola.info(`📤 Antigravity: ${model} | ${url} | Stream: ${stream}`)

    const antigravityPayload = translateOpenAIToAntigravity(
      payload,
      tokenData.project_id ?? "",
    )

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(antigravityPayload),
    })

    if (!response.ok) {
      if (!tokenData.project_id && response.status >= 500) {
        throw new HTTPError(
          "Antigravity project ID unavailable",
          new Response(
            JSON.stringify({
              error: {
                message:
                  "Antigravity project ID is unavailable for this account. Re-run auth or complete account verification in an official client, then retry.",
                code: "project_id_unavailable",
              },
            }),
            {
              status: 503,
              headers: { "content-type": "application/json" },
            },
          ),
        )
      }

      throw new HTTPError("Antigravity chat completions failed", response)
    }

    const requestId = antigravityPayload.requestId

    if (stream) {
      // Transform Antigravity newline-delimited JSON stream → OpenAI SSE stream
      const { readable, writable } = new TransformStream<
        Uint8Array,
        Uint8Array
      >()
      const writer = writable.getWriter()
      const encoder = new TextEncoder()

      ;(async () => {
        try {
          const reader = response.body?.getReader()
          if (!reader) {
            await writer.close()
            return
          }

          const decoder = new TextDecoder()
          let buffer = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""

            for (const line of lines) {
              const lineData = parseAntigravityStreamLine(line)
              if (!lineData) continue
              const inner = lineData.response
              if (!inner) continue

              const chunks = antigravityStreamLineToOpenAIChunks(
                inner,
                model,
                requestId,
              )
              for (const chunk of chunks) {
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
                )
              }
            }
          }

          await writer.write(encoder.encode("data: [DONE]\n\n"))
        } finally {
          await writer.close().catch(() => {})
        }
      })()

      return new Response(readable, {
        headers: { "content-type": "text/event-stream" },
      })
    }

    // Non-streaming: collect full newline-delimited JSON stream and merge
    const text = await response.text()
    const lines = text.split("\n").filter((l) => l.trim())
    let lastInner: AntigravityInnerResponse = {}
    const allCandidates: Array<AntigravityCandidate> = []

    for (const line of lines) {
      const lineData = parseAntigravityStreamLine(line)
      if (!lineData) continue
      const inner = lineData.response
      if (!inner) continue
      lastInner = inner
      if (inner.candidates) {
        for (const cand of inner.candidates) {
          if (allCandidates.length === 0) {
            allCandidates.push({ ...cand })
          } else {
            // Merge parts into first candidate
            const existing = allCandidates[0]
            existing.content ??= { role: "model", parts: [] }
            existing.content.parts.push(...(cand.content?.parts ?? []))
            if (cand.finishReason) existing.finishReason = cand.finishReason
          }
        }
      }
    }

    const mergedInner: AntigravityInnerResponse = {
      candidates:
        allCandidates.length > 0 ? allCandidates : lastInner.candidates,
      usageMetadata: lastInner.usageMetadata,
      modelVersion: lastInner.modelVersion,
    }

    if (!mergedInner.candidates?.length) {
      throw new Error("Antigravity returned no parseable completion candidates")
    }

    consola.debug("Antigravity response merged successfully")
    const openAIResp = antigravityResponseToOpenAI(
      mergedInner,
      model,
      requestId,
    )
    return new Response(JSON.stringify(openAIResp), {
      headers: { "content-type": "application/json" },
    })
  }

  async createEmbeddings(_payload: Record<string, unknown>): Promise<Response> {
    // Antigravity (Google Cloud Code) does not expose a public embeddings endpoint
    return new Response(
      JSON.stringify({
        error: "Embeddings not supported by Antigravity provider",
      }),
      { status: 501, headers: { "content-type": "application/json" } },
    )
  }

  async getUsage(): Promise<Response> {
    const tokenData = await this.ensureValidToken()
    return new Response(
      JSON.stringify({
        provider: "antigravity",
        email: tokenData.email ?? "unknown",
        project_id: tokenData.project_id ?? "unknown",
        token_expires_at: new Date(tokenData.expires_at).toISOString(),
      }),
      { headers: { "content-type": "application/json" } },
    )
  }
}

export const __test__ = {
  parseAntigravityStreamLine,
}
