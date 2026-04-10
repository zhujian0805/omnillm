import consola from "consola"

import { state } from "~/lib/state"
import { providerRegistry } from "~/providers/registry"
import type { Provider } from "~/providers/types"
import type { Model, ModelsResponse } from "~/services/copilot/get-models"

export interface ResolvedModelRoute {
  selectedModel: Model | null
  candidateProviders: Array<Provider>
  availableModels: Array<Model>
}

async function getCachedOrFetchModels(
  provider: Provider,
): Promise<ModelsResponse | null> {
  let providerModels = state.providerModels.get(provider.instanceId)
  if (providerModels) {
    return providerModels
  }

  try {
    providerModels = await provider.getModels()
    state.providerModels.set(provider.instanceId, providerModels)
    return providerModels
  } catch (error) {
    consola.warn(`Failed to get models from ${provider.name}:`, error)
    return null
  }
}

export async function getEnabledModelsByProvider(
  providers = providerRegistry.getActiveProviders(),
): Promise<Map<string, Array<Model>>> {
  const modelsByProvider = new Map<string, Array<Model>>()

  for (const provider of providers) {
    const providerModels = await getCachedOrFetchModels(provider)
    if (!providerModels) {
      continue
    }

    const disabled = state.disabledModels.get(provider.instanceId) ?? new Set<string>()
    const enabledModels = providerModels.data.filter((model) => !disabled.has(model.id))
    modelsByProvider.set(provider.instanceId, enabledModels)
  }

  return modelsByProvider
}

export function sortProvidersByPriority<T extends Provider>(
  providers: Array<T>,
): Array<T> {
  return [...providers].sort((a, b) => {
    const pa = state.providerPriorities.get(a.instanceId) ?? 0
    const pb = state.providerPriorities.get(b.instanceId) ?? 0
    return pa - pb
  })
}

export async function resolveProvidersForModel(
  requestedModel: string,
  normalizedModel = requestedModel,
): Promise<ResolvedModelRoute | null> {
  const activeProviders = providerRegistry.getActiveProviders()
  if (activeProviders.length === 0) {
    return null
  }

  const modelsByProvider = await getEnabledModelsByProvider(activeProviders)
  const availableModels = Array.from(modelsByProvider.values()).flat()

  const selectedModel = availableModels.find(
    (model) => model.id === requestedModel || model.id === normalizedModel,
  )

  if (!selectedModel) {
    return {
      selectedModel: null,
      candidateProviders: [],
      availableModels,
    }
  }

  const candidateProviders = sortProvidersByPriority(
    activeProviders.filter((provider) => {
      const providerModels = modelsByProvider.get(provider.instanceId) ?? []
      return providerModels.some(
        (model) => model.id === requestedModel || model.id === normalizedModel,
      )
    }),
  )

  return {
    selectedModel,
    candidateProviders,
    availableModels,
  }
}
