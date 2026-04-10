// ─────────────────────────────────────────────────────────
// Canonical content part types
// ─────────────────────────────────────────────────────────

export interface CIFTextPart {
  type: "text"
  text: string
}

export interface CIFImagePart {
  type: "image"
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  data?: string // base64 encoded bytes
  url?: string // data: URI or https URL
}

export interface CIFThinkingPart {
  type: "thinking"
  thinking: string
  signature?: string // Antigravity thoughtSignature
}

export interface CIFToolCallPart {
  type: "tool_call"
  toolCallId: string
  toolName: string
  toolArguments: Record<string, unknown>
}

export interface CIFToolResultPart {
  type: "tool_result"
  toolCallId: string
  toolName: string // name is needed by Antigravity functionResponse
  content: string // serialized result text
  isError?: boolean
}

export type CIFContentPart =
  | CIFTextPart
  | CIFImagePart
  | CIFThinkingPart
  | CIFToolCallPart
  | CIFToolResultPart

// ─────────────────────────────────────────────────────────
// Canonical message types
// ─────────────────────────────────────────────────────────

export interface CIFSystemMessage {
  role: "system"
  content: string // always plain text; multiple system blocks are joined
}

export interface CIFUserMessage {
  role: "user"
  content: Array<CIFContentPart> // may include text, image, tool_result parts
}

export interface CIFAssistantMessage {
  role: "assistant"
  content: Array<CIFContentPart> // may include text, thinking, tool_call parts
}

export type CIFMessage = CIFSystemMessage | CIFUserMessage | CIFAssistantMessage

// ─────────────────────────────────────────────────────────
// Canonical tool definition
// ─────────────────────────────────────────────────────────

export interface CIFTool {
  name: string
  description?: string
  parametersSchema: Record<string, unknown> // JSON Schema object
}

export type CIFToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; functionName: string }

// ─────────────────────────────────────────────────────────
// Canonical request
// ─────────────────────────────────────────────────────────

export interface CanonicalRequest {
  /** Model name exactly as the caller specified it, before any provider remapping */
  model: string

  /** System prompt, if any. Placed before messages. */
  systemPrompt?: string

  /** Ordered conversation history */
  messages: Array<CIFMessage>

  /** Tools the model may call */
  tools?: Array<CIFTool>
  toolChoice?: CIFToolChoice

  // Sampling parameters — all optional
  temperature?: number
  topP?: number
  maxTokens?: number
  stop?: Array<string> // always array; adapters normalise string→[string]
  stream: boolean // required, default false

  // Pass-through metadata (forwarded to provider if understood)
  userId?: string

  // Extended / provider-specific hints (type-safe escape hatch)
  extensions?: {
    /** Anthropic thinking budget */
    thinkingBudgetTokens?: number
    /** Qwen needs dummy tool injection — flag set by Alibaba adapter */
    requiresDummyToolInjection?: boolean
  }
}

// ─────────────────────────────────────────────────────────
// Canonical response
// ─────────────────────────────────────────────────────────

export type CIFStopReason =
  | "end_turn" // natural stop
  | "max_tokens" // hit token limit
  | "tool_use" // model wants to call a tool
  | "stop_sequence" // matched a stop string
  | "content_filter" // safety filter
  | "error"

export interface CIFUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheWriteInputTokens?: number
}

export interface CanonicalResponse {
  /** Provider-assigned response ID */
  id: string
  /** The model name reported by the provider (may differ from request model) */
  model: string
  /** All generated content, in order */
  content: Array<CIFContentPart> // text, thinking, tool_call parts
  stopReason: CIFStopReason
  stopSequence?: string | null
  usage?: CIFUsage
}

// ─────────────────────────────────────────────────────────
// Streaming canonical events
// ─────────────────────────────────────────────────────────

export interface CIFStreamStart {
  type: "stream_start"
  id: string
  model: string
}

export interface CIFContentDelta {
  type: "content_delta"
  index: number
  /** For new blocks: includes full part shape with empty/partial content */
  contentBlock?: CIFContentPart
  /** Delta for text or tool argument accumulation */
  delta:
    | { type: "text_delta"; text: string }
    | { type: "thinking_delta"; thinking: string }
    | { type: "tool_arguments_delta"; partialJson: string }
}

export interface CIFContentBlockStop {
  type: "content_block_stop"
  index: number
}

export interface CIFStreamEnd {
  type: "stream_end"
  stopReason: CIFStopReason
  stopSequence?: string | null
  usage?: CIFUsage
}

export interface CIFStreamError {
  type: "stream_error"
  error: { type: string; message: string }
}

export type CIFStreamEvent =
  | CIFStreamStart
  | CIFContentDelta
  | CIFContentBlockStop
  | CIFStreamEnd
  | CIFStreamError
