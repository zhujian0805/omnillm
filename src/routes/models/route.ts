import { Hono } from "hono"
import consola from "consola"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import { providerRegistry } from "~/providers/registry"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    const activeProviders = providerRegistry.getActiveProviders()

    if (activeProviders.length === 0) {
      // No active providers - return empty model list
      return c.json({
        object: "list",
        data: [],
        has_more: false,
      })
    }

    if (activeProviders.length > 1) {
      // Multi-provider: aggregate enabled models from all active providers
      const allModels: Array<{
        id: string
        object: string
        type: string
        created: number
        created_at: string
        owned_by: string | undefined
        display_name: string | undefined
      }> = []

      for (const provider of activeProviders) {
        let providerModels = state.providerModels.get(provider.instanceId)
        if (!providerModels) {
          providerModels = await provider.getModels()
          state.providerModels.set(provider.instanceId, providerModels)
        }

        const disabled =
          state.disabledModels.get(provider.instanceId) ?? new Set<string>()
        const enabledModels = providerModels.data.filter(
          (model) => !disabled.has(model.id),
        )

        allModels.push(
          ...enabledModels.map((model) => ({
            id: model.id,
            object: "model",
            type: "model",
            created: 0,
            created_at: new Date(0).toISOString(),
            owned_by: model.vendor,
            display_name: model.name,
          })),
        )
      }

      return c.json({ object: "list", data: allModels, has_more: false })
    }

    // Single provider path (legacy)
    let modelsResponse = state.models
    if (!modelsResponse) {
      const provider = activeProviders[0] // Use first active provider
      if (provider) {
        try {
          const fetchedModels = await provider.getModels()
          modelsResponse = fetchedModels
          // eslint-disable-next-line require-atomic-updates
          state.models = fetchedModels
        } catch (error) {
          consola.warn(`Failed to get models from ${provider.name}:`, error)
          // Return empty list instead of crashing
          return c.json({
            object: "list",
            data: [],
            has_more: false,
          })
        }
      } else {
        // No provider available, return empty list
        return c.json({
          object: "list",
          data: [],
          has_more: false,
        })
      }
    }

    const activeProvider = state.currentProvider
    const disabled =
      activeProvider ?
        (state.disabledModels.get(activeProvider.instanceId)
        ?? new Set<string>())
      : new Set<string>()

    const models = modelsResponse?.data
      .filter((model) => !disabled.has(model.id))
      .map((model) => ({
        id: model.id,
        object: "model",
        type: "model",
        created: 0,
        created_at: new Date(0).toISOString(),
        owned_by: model.vendor,
        display_name: model.name,
      }))

    return c.json({
      object: "list",
      data: models,
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
