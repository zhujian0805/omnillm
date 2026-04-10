import type { Context } from "hono"

import consola from "consola"
import { events } from "fetch-event-stream"
import { streamSSE, type SSEMessage } from "hono/streaming"

// CIF imports
import { parseResponsesPayload } from "~/ingestion/from-responses"
import { awaitApproval } from "~/lib/approval"
import { isModelNotSupportedError } from "~/lib/error"
import { checkRateLimit } from "~/lib/rate-limit"
import { resolveProvidersForModel } from "~/lib/model-routing"
import { state } from "~/lib/state"
import { providerRegistry } from "~/providers/registry"
import {
  serializeToResponses,
  cifEventToResponsesSSE,
  createResponsesStreamState,
} from "~/serialization"
import {
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import type { ResponsesPayload } from "./types"

import {
  initStreamState,
  translateChunkToResponsesEvents,
  translateRequestToOpenAI,
  translateResponseToResponses,
} from "./translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const responsesPayload = await c.req.json<ResponsesPayload>()
  consola.debug(
    `Responses API request summary: model=${responsesPayload.model}, input_messages=${Array.isArray(responsesPayload.input) ? responsesPayload.input.length : 0}, tools=${responsesPayload.tools?.length ?? 0}, max_output_tokens=${responsesPayload.max_output_tokens}`,
  )

  const openAIPayload = translateRequestToOpenAI(responsesPayload)
  consola.info(`📤 Model called: ${responsesPayload.model} (Responses API)`)

  consola.debug(
    `Translated payload: ${openAIPayload.messages?.length ?? 0} messages, tools: ${openAIPayload.tools?.length ?? 0}, max_tokens: ${openAIPayload.max_tokens}`,
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const requestedModel = responsesPayload.model
  const resolvedRoute = await resolveProvidersForModel(requestedModel)

  if (!resolvedRoute || resolvedRoute.candidateProviders.length === 0) {
    return c.json(
      {
        error: {
          type: "provider_error",
          message:
            "No active providers available. Please activate a provider through the admin interface.",
        },
      },
      503,
    )
  }

  const { candidateProviders } = resolvedRoute
  const sortedProviders = candidateProviders

  let firstError: unknown
  let firstRelevantError: unknown

  for (const provider of sortedProviders) {
    try {
      // Try CIF path first if adapter is available
      if (provider.adapter) {
        consola.debug(
          `Using CIF adapter for ${provider.name} (${provider.instanceId})`,
        )

        const canonicalReq = parseResponsesPayload(responsesPayload)

        // Apply model remapping if needed
        const remappedModel =
          provider.adapter.remapModel?.(canonicalReq.model)
          ?? canonicalReq.model
        const finalCanonicalReq = { ...canonicalReq, model: remappedModel }

        if (canonicalReq.stream) {
          consola.debug("Streaming response via CIF adapter")
          return streamSSE(c, async (stream) => {
            const cifStreamState = createResponsesStreamState()

            for await (const cifEvent of provider.adapter!.executeStream(
              finalCanonicalReq,
            )) {
              const responsesEvents = cifEventToResponsesSSE(
                cifEvent,
                cifStreamState,
              )
              for (const event of responsesEvents) {
                await stream.writeSSE({
                  event: event.type,
                  data: JSON.stringify(event),
                })
              }
            }
          })
        } else {
          const canonicalResp =
            await provider.adapter.execute(finalCanonicalReq)
          const responsesResponse = serializeToResponses(canonicalResp)
          return c.json(responsesResponse)
        }
      }

      // Fallback to existing translation path
      consola.debug(
        `Trying ${provider.name} (${provider.instanceId}) for model ${responsesPayload.model} (legacy path)`,
      )

      const response = await provider.createChatCompletions(
        openAIPayload as unknown as Record<string, unknown>,
      )

      if (responsesPayload.stream) {
        consola.debug("Streaming response from provider")
        return streamSSE(c, async (stream) => {
          const streamState = initStreamState()

          for await (const rawEvent of events(response)) {
            consola.debug(
              "Provider raw stream event:",
              JSON.stringify(rawEvent).slice(-200),
            )
            if (rawEvent.data === "[DONE]") {
              break
            }
            if (!rawEvent.data) {
              continue
            }

            const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
            const respEvents = translateChunkToResponsesEvents(
              chunk,
              streamState,
            )

            for (const event of respEvents) {
              await stream.writeSSE({
                event: event.type,
                data: JSON.stringify(event),
              } as SSEMessage)
            }
          }
        })
      }

      const json = (await response.json()) as ChatCompletionResponse
      const responsesResponse = translateResponseToResponses(json)
      consola.debug(
        "Translated Responses API response:",
        JSON.stringify(responsesResponse).slice(-400),
      )
      return c.json(responsesResponse)
    } catch (err) {
      firstError ??= err
      if (!firstRelevantError && !(await isModelNotSupportedError(err))) {
        firstRelevantError = err
      }

      const errorMsg = err instanceof Error ? err.message : String(err)
      consola.warn(
        `${provider.name} (${provider.instanceId}) failed for model ${responsesPayload.model}, trying next provider: ${errorMsg}`,
      )
      continue
    }
  }

  throw (
    firstRelevantError
    ?? firstError
    ?? new Error(
      `All active providers failed for model ${responsesPayload.model}`,
    )
  )
}
