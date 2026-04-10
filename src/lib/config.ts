import consola from "consola"

import type { ProviderID } from "~/providers/types"

import { PATHS } from "./paths"
import { state } from "./state"

interface ProviderInstanceConfig {
  id: ProviderID
  instanceId: string
  name: string
  activated: 0 | 1 // 0 = inactive, 1 = active
}

interface AppConfig {
  providerPriorities?: Record<string, number>
  providerInstances?: Array<ProviderInstanceConfig>
}

export async function loadConfig(): Promise<void> {
  const file = Bun.file(PATHS.CONFIG_FILE)
  const exists = await file.exists()
  if (!exists) {
    // Default: github-copilot has top priority (0)
    state.providerPriorities.set("github-copilot", 0)
    return
  }

  try {
    const config = (await file.json()) as AppConfig

    // Load provider priorities
    if (
      config.providerPriorities
      && typeof config.providerPriorities === "object"
    ) {
      state.providerPriorities.clear()
      for (const [id, priority] of Object.entries(config.providerPriorities)) {
        if (typeof priority === "number") {
          state.providerPriorities.set(id, priority)
        }
      }
      consola.debug(
        "Loaded provider priorities from config:",
        config.providerPriorities,
      )
    } else {
      state.providerPriorities.set("github-copilot", 0)
    }

    // Load provider instances
    if (config.providerInstances && Array.isArray(config.providerInstances)) {
      await loadProviderInstances(config.providerInstances)
    }
  } catch (err) {
    consola.warn("Failed to parse config file, using defaults:", err)
    state.providerPriorities.set("github-copilot", 0)
  }
}

async function loadProviderInstances(
  instances: Array<ProviderInstanceConfig>,
): Promise<void> {
  const { providerRegistry } = await import("~/providers/registry")

  for (const instance of instances) {
    // Skip if already registered (e.g., from auto-discovery)
    if (providerRegistry.isRegistered(instance.instanceId)) {
      consola.debug(
        `Provider instance already registered: ${instance.instanceId}`,
      )

      // Still need to restore activation state for existing instances
      if (instance.activated === 1) {
        providerRegistry.setActive(instance.instanceId)
      }
      continue
    }

    try {
      let provider
      switch (instance.id) {
        case "github-copilot": {
          const { GitHubCopilotProvider } = await import(
            "~/providers/github-copilot"
          )
          provider = new GitHubCopilotProvider(instance.instanceId)
          provider.name = instance.name
          break
        }
        case "antigravity": {
          const { AntigravityProvider } = await import(
            "~/providers/antigravity"
          )
          provider = new AntigravityProvider(instance.instanceId)
          provider.name = instance.name
          break
        }
        case "alibaba": {
          const { AlibabaProvider } = await import("~/providers/alibaba")
          provider = new AlibabaProvider(instance.instanceId)
          provider.name = instance.name
          break
        }
        default: {
          consola.warn(`Unknown provider type in config: ${instance.id}`)
          continue
        }
      }

      await providerRegistry.register(provider, { saveConfig: false })

      if (instance.activated === 1) {
        providerRegistry.setActive(instance.instanceId)
      }

      consola.debug(
        `Restored provider instance from config: ${instance.instanceId} (activated: ${String(instance.activated)})`,
      )
    } catch (err) {
      consola.warn(
        `Failed to restore provider instance ${instance.instanceId}:`,
        err,
      )
    }
  }
}

export async function saveConfig(): Promise<void> {
  const { providerRegistry } = await import("~/providers/registry")

  // Save provider priorities
  const priorities: Record<string, number> = {}
  for (const [id, priority] of state.providerPriorities.entries()) {
    priorities[id] = priority
  }

  // Save provider instances with activation states
  const instances: Array<ProviderInstanceConfig> = []
  for (const provider of providerRegistry.getProviderMap().values()) {
    instances.push({
      id: provider.id,
      instanceId: provider.instanceId,
      name: provider.name,
      activated: providerRegistry.isActiveProvider(provider.instanceId) ? 1 : 0,
    })
  }

  const config: AppConfig = {
    providerPriorities: priorities,
    providerInstances: instances,
  }

  try {
    await Bun.write(PATHS.CONFIG_FILE, JSON.stringify(config, null, 2))
    consola.debug("Saved config:", {
      priorities,
      instanceCount: instances.length,
      activeCount: instances.filter((i) => i.activated === 1).length,
    })
  } catch (err) {
    consola.warn("Failed to save config file:", err)
  }
}
