import consola from "consola"

import type {
  ResponsesPayload,
  ResponsesResponse,
} from "~/routes/responses/types"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { describeErrorResponse, HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createResponses = async (
  payload: ResponsesPayload,
  providerInfo?: { name?: string; instanceId?: string },
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const isAgentCall =
    Array.isArray(payload.input)
    && payload.input.some((item) => item.role === "assistant")

  const headers: Record<string, string> = {
    ...copilotHeaders(state, false),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const providerLabel =
    providerInfo ?
      `${providerInfo.name} (${providerInfo.instanceId})`
    : "Copilot Responses API"
  consola.info(
    `🚀 Sending request to ${providerLabel} - Model: ${payload.model}, Stream: ${payload.stream ? "yes" : "no"}`,
  )

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error(
      "Failed to create responses",
      await describeErrorResponse(response),
    )
    throw new HTTPError("Failed to create responses", response)
  }

  if (payload.stream) {
    return response
  }

  return (await response.json()) as ResponsesResponse
}

export { type ResponsesEvent } from "~/routes/responses/types"
