import type {
  LbStrategy,
  Model,
  Provider,
  VirtualModel,
  VirtualModelUpstream,
} from "@/api"

interface UpstreamResolutionContext {
  providers: Array<Provider>
  providerModels: Record<string, Array<Model>>
  providerNameById: Record<string, string>
}

export function detectModelFamily(modelId?: string | null) {
  if (!modelId) return null

  const normalized = modelId.toLowerCase()
  if (normalized.includes("claude")) return "Claude"
  if (
    normalized.includes("gpt")
    || normalized.includes("o1")
    || normalized.includes("o3")
  ) {
    return "OpenAI"
  }
  if (normalized.includes("qwen")) return "Qwen"
  if (normalized.includes("gemini")) return "Gemini"

  return null
}

export function resolveUpstreamProvider(
  upstream: Pick<VirtualModelUpstream, "provider_id" | "model_id">,
  context: UpstreamResolutionContext,
) {
  const { providers, providerModels, providerNameById } = context
  const matchingProviders = providers.filter((provider) =>
    (providerModels[provider.id] ?? []).some(
      (model) => model.id === upstream.model_id,
    ),
  )
  const inferredProviderId =
    matchingProviders.length === 1 ? matchingProviders[0].id : undefined
  const providerId = upstream.provider_id || inferredProviderId

  let providerLabel = "Unknown legacy provider"
  if (providerId) {
    providerLabel = providerNameById[providerId] ?? providerId
  } else if (matchingProviders.length > 1) {
    providerLabel = "Ambiguous legacy provider"
  }

  return {
    providerLabel,
    isLegacy: !upstream.provider_id,
  }
}

function formatVirtualModelRouteLabel(
  lbStrategy: LbStrategy,
  upstream: { weight?: number },
  index: number,
): string {
  switch (lbStrategy) {
    case "priority": {
      return index === 0 ? "primary" : `fallback ${index}`
    }
    case "weighted": {
      return `weight ${upstream.weight ?? 1}`
    }
    case "round-robin": {
      return `round-robin ${index + 1}`
    }
    case "random": {
      return `random ${index + 1}`
    }
    default: {
      return `random ${index + 1}`
    }
  }
}

export function formatVirtualModelUpstreamSummary(
  vm: Pick<VirtualModel, "lb_strategy" | "upstreams">,
  context: UpstreamResolutionContext,
): string {
  return vm.upstreams
    .map((upstream, index) => {
      const { providerLabel } = resolveUpstreamProvider(upstream, context)
      return `${formatVirtualModelRouteLabel(vm.lb_strategy, upstream, index)}: ${providerLabel} · ${upstream.model_id}`
    })
    .join("\n")
}
