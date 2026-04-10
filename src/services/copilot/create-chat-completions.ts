import consola from "consola"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { describeErrorResponse, HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

async function doFetch(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  return response
}

function normalizeToolCall(toolCall: ToolCall): ToolCall {
  return {
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    },
  }
}

export function normalizeChatCompletionResponse(
  response: ChatCompletionResponse,
  model: string,
): ChatCompletionResponse {
  return {
    id: response.id,
    object: "chat.completion",
    created:
      typeof response.created === "number" ?
        response.created
      : Math.floor(Date.now() / 1000),
    model: response.model || model,
    choices: response.choices.map((choice) => ({
      index: choice.index,
      message: {
        role: "assistant",
        content: choice.message.content,
        ...(choice.message.tool_calls && {
          tool_calls: choice.message.tool_calls.map((toolCall) =>
            normalizeToolCall(toolCall),
          ),
        }),
      },
      logprobs: choice.logprobs ?? null,
      finish_reason: choice.finish_reason,
    })),
    ...(response.system_fingerprint && {
      system_fingerprint: response.system_fingerprint,
    }),
    ...(response.usage && { usage: response.usage }),
  }
}

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
  providerInfo?: { name?: string; instanceId?: string },
  githubToken?: string,
) => {
  // In multi-provider setup, we need the GitHub token to get the Copilot token
  const token = githubToken || state.githubToken

  if (!token) {
    throw new Error("GitHub token is required for chat completions API")
  }

  // Get Copilot token using the GitHub token
  const { getCopilotToken } = await import(
    "~/services/github/get-copilot-token"
  )

  // Create temporary state with the GitHub token for this request
  const originalGithubToken = state.githubToken
  state.githubToken = token

  let copilotToken: string

  try {
    const copilotTokenResponse = await getCopilotToken()
    copilotToken = copilotTokenResponse.token

    // Temporarily set the Copilot token in state for header generation
    const originalCopilotToken = state.copilotToken
    state.copilotToken = copilotToken

    const enableVision = payload.messages.some(
      (x) =>
        typeof x.content !== "string"
        && x.content?.some((x) => x.type === "image_url"),
    )

    const isAgentCall = payload.messages.some((msg) =>
      ["assistant", "tool"].includes(msg.role),
    )

    const headers: Record<string, string> = {
      ...copilotHeaders(state, enableVision),
      "X-Initiator": isAgentCall ? "agent" : "user",
    }

    // Restore original Copilot token
    state.copilotToken = originalCopilotToken

    const providerLabel =
      providerInfo ?
        `${providerInfo.name} (${providerInfo.instanceId})`
      : "Copilot API"
    consola.info(
      `🚀 Sending request to ${providerLabel} - Model: ${payload.model}, Stream: ${payload.stream ? "yes" : "no"}, Vision: ${enableVision ? "yes" : "no"}`,
    )

    const url = `${copilotBaseUrl(state)}/chat/completions`

    // Strip nullish fields to avoid sending unsupported params
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== null && v !== undefined),
    )

    let response = await doFetch(url, headers, body)

    // Some models (e.g. gpt-5.4) require max_completion_tokens instead of max_tokens
    if (!response.ok) {
      const errorText = await response.text()
      if (
        errorText.includes("max_tokens")
        && errorText.includes("max_completion_tokens")
        && "max_tokens" in body
      ) {
        consola.info(
          "Retrying with max_completion_tokens instead of max_tokens",
        )
        const retryBody = { ...body, max_completion_tokens: body.max_tokens }
        delete retryBody.max_tokens
        response = await doFetch(url, headers, retryBody)
        if (!response.ok) {
          consola.warn(
            "Failed to create chat completions (retry)",
            await describeErrorResponse(response),
          )
          throw new HTTPError("Failed to create chat completions", response)
        }
      } else {
        consola.warn("Failed to create chat completions", {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        })
        // Re-create a response-like error with the already-consumed body
        throw new HTTPError(
          "Failed to create chat completions",
          new Response(errorText, {
            status: response.status,
            headers: response.headers,
          }),
        )
      }
    }

    if (payload.stream) {
      return response
    }

    return normalizeChatCompletionResponse(
      (await response.json()) as ChatCompletionResponse,
      payload.model,
    )
  } finally {
    // Always restore original GitHub token
    state.githubToken = originalGithubToken
  }
}

// Streaming types

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<Choice>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
}

interface Delta {
  content?: string | null
  role?: "user" | "assistant" | "system" | "tool"
  tool_calls?: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs: object | null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<ChoiceNonStreaming>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
  }
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  tool_calls?: Array<ToolCall>
}

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  stop?: string | Array<string> | null
  n?: number | null
  stream?: boolean | null

  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  logprobs?: boolean | null
  response_format?: { type: "json_object" } | null
  seed?: number | null
  tools?: Array<Tool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  user?: string | null
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer"
  content: string | Array<ContentPart> | null

  name?: string
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type ContentPart = TextPart | ImagePart

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: {
    url: string
    detail?: "low" | "high" | "auto"
  }
}
