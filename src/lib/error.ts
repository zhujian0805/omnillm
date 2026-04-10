import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

export class HTTPError extends Error {
  response: Response

  constructor(message: string, response: Response) {
    super(message)
    this.response = response
  }
}

function parseNestedJSON(value: string): unknown {
  try {
    return parseErrorPayload(JSON.parse(value) as unknown)
  } catch {
    return value
  }
}

export function parseErrorPayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    return parseNestedJSON(payload)
  }

  if (!payload || typeof payload !== "object") {
    return payload
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => parseErrorPayload(item))
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      parseErrorPayload(value),
    ]),
  )
}

export function summarizeHTTPError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return typeof payload === "string" ? payload : null
  }

  const errorObject =
    "error" in payload && payload.error && typeof payload.error === "object" ?
      (payload.error as Record<string, unknown>)
    : (payload as Record<string, unknown>)

  const upstreamMessage =
    typeof errorObject.message === "string" ? errorObject.message : null

  if (upstreamMessage === "Verify your account to continue.") {
    return [
      "Antigravity account verification is required.",
      "Open an official Google Antigravity or Gemini Code Assist client with this account,",
      "complete the verification prompt, then retry.",
    ].join(" ")
  }

  const upstreamCode =
    typeof errorObject.code === "string" ? errorObject.code : null

  if (upstreamCode === "unsupported_api_for_model" && upstreamMessage) {
    const match = upstreamMessage.match(
      /model "([^"]+)" is not accessible via the (\/[^ ]+) endpoint/i,
    )

    if (match) {
      const [, model, endpoint] = match

      if (endpoint === "/chat/completions") {
        return [
          `Model "${model}" is not supported on the upstream ${endpoint} endpoint.`,
          "Use the proxy's /v1/responses endpoint or switch to a model that supports chat completions.",
        ].join(" ")
      }

      return `Model "${model}" is not supported on the upstream ${endpoint} endpoint.`
    }
  }

  return upstreamMessage
}

export async function describeErrorResponse(response: Response): Promise<{
  status: number
  statusText: string
  body: unknown
}> {
  const text = await readResponseText(response)

  return {
    status: response.status,
    statusText: response.statusText,
    body: text === null ? null : parseNestedJSON(text),
  }
}

export async function isUnsupportedApiForModel(
  error: unknown,
): Promise<boolean> {
  const code = await getHTTPErrorCode(error)
  return code === "unsupported_api_for_model"
}

export async function isModelNotSupportedError(
  error: unknown,
): Promise<boolean> {
  const code = await getHTTPErrorCode(error)
  return code === "unsupported_api_for_model" || code === "model_not_supported"
}

async function getHTTPErrorCode(error: unknown): Promise<string | null> {
  if (!(error instanceof HTTPError)) return null
  try {
    const json = await getHTTPErrorPayload(error)
    if (json && typeof json === "object" && "error" in json) {
      const e = (json as Record<string, unknown>).error
      if (e && typeof e === "object" && "code" in e) {
        const code = (e as Record<string, unknown>).code
        return typeof code === "string" ? code : null
      }
    }
  } catch {
    // ignore parse errors
  }
  return null
}

async function getHTTPErrorPayload(error: HTTPError): Promise<unknown> {
  const text = await readResponseText(error.response)
  return text === null ? null : parseNestedJSON(text)
}

async function readResponseText(response: Response): Promise<string | null> {
  try {
    const text = await response.clone().text()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

export async function shouldFallbackToResponsesAPI(
  error: unknown,
): Promise<boolean> {
  if (!(error instanceof HTTPError)) return false

  // First check if it's an unsupported model
  if (await isUnsupportedApiForModel(error)) return true

  // Also fall back for tool-related errors (some models don't support tools via chat/completions)
  try {
    const json = await getHTTPErrorPayload(error)
    if (json && typeof json === "object" && "error" in json) {
      const e = (json as Record<string, unknown>).error
      if (e && typeof e === "object") {
        const message = (e as Record<string, unknown>).message
        if (typeof message === "string" && message.includes("tools")) {
          return true
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  return false
}

export async function forwardError(c: Context, error: unknown) {
  consola.error("Error occurred:", error)

  if (error instanceof HTTPError) {
    const errorText = await readResponseText(error.response)
    const errorJson = errorText === null ? null : parseNestedJSON(errorText)
    const errorMessage =
      summarizeHTTPError(errorJson) ?? errorText ?? error.message
    consola.error("HTTP error:", errorJson)
    return c.json(
      {
        error: {
          message: errorMessage,
          ...(errorJson !== null ? { upstream: errorJson } : {}),
          type: "error",
        },
      },
      error.response.status as ContentfulStatusCode,
    )
  }

  return c.json(
    {
      error: {
        message: (error as Error).message,
        type: "error",
      },
    },
    500,
  )
}
