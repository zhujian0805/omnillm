import consola from "consola"
import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import { providerRegistry } from "~/providers/registry"
import {
  createEmbeddings,
  type EmbeddingRequest,
} from "~/services/copilot/create-embeddings"

export const embeddingRoutes = new Hono()

embeddingRoutes.post("/", async (c) => {
  try {
    const payload = await c.req.json<EmbeddingRequest>()

    // Use the active provider if set and not Copilot
    // When multiple providers are active, sort by priority and try each in order
    const activeProviders = providerRegistry.getActiveProviders()
    let tryProviders: Array<(typeof activeProviders)[number]> = []

    if (activeProviders.length > 1) {
      // Sort all active providers by priority
      const sortedProviders = activeProviders.sort((a, b) => {
        const pa = state.providerPriorities.get(a.instanceId) ?? 0
        const pb = state.providerPriorities.get(b.instanceId) ?? 0
        return pa - pb
      })
      // Try all active providers in priority order (let them decide if they support the model)
      tryProviders = sortedProviders
    } else if (activeProviders.length === 1) {
      // Try the single active provider (including GitHub Copilot instances)
      tryProviders = activeProviders
    } else if (
      state.currentProvider
      && state.currentProvider.id !== "github-copilot"
    ) {
      tryProviders = [state.currentProvider]
    }

    // Try each provider in priority order
    for (const tryProvider of tryProviders) {
      try {
        consola.debug(
          `Trying ${tryProvider.name} (${tryProvider.instanceId}) for embeddings`,
        )
        const response = await tryProvider.createEmbeddings(
          payload as unknown as Record<string, unknown>,
        )
        const data = await response.json()
        return c.json(data, response.status as 200)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        consola.warn(
          `${tryProvider.name} (${tryProvider.instanceId}) failed for embeddings, trying next provider: ${errorMsg}`,
        )
        continue
      }
    }

    // Copilot fallback
    // Check if there's a GitHub Copilot provider to identify in logs
    const activeCopilotProviders = activeProviders.filter(
      (p) => p.id === "github-copilot",
    )
    const copilotProviderInfo =
      activeCopilotProviders.length > 0 ?
        `${activeCopilotProviders[0].name} (${activeCopilotProviders[0].instanceId})`
      : state.currentProvider?.id === "github-copilot" ?
        `${state.currentProvider.name} (${state.currentProvider.instanceId})`
      : "Copilot API"

    consola.info(`📤 ${copilotProviderInfo} embeddings fallback`)
    const response = await createEmbeddings(payload)
    return c.json(response)
  } catch (error) {
    return await forwardError(c, error)
  }
})
