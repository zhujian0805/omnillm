import consola from "consola"

import {
  ConfigStore,
  ProviderInstanceStore,
  ModelStateStore,
  initializeDatabase,
} from "./database"
import { migrateFromFilesToDatabase, shouldRunMigration } from "./migration"
import { state } from "./state"

export async function loadConfig(): Promise<void> {
  // Initialize database first
  await initializeDatabase()

  // Check if we need to run migration from legacy files
  if (await shouldRunMigration()) {
    consola.info(
      "Detected legacy configuration files, migrating to database...",
    )
    await migrateFromFilesToDatabase()
  }

  // Load provider priorities from database
  try {
    const providerInstances = ProviderInstanceStore.getAll()
    state.providerPriorities.clear()

    if (providerInstances.length === 0) {
      // Default: github-copilot has top priority (0)
      state.providerPriorities.set("github-copilot", 0)
      consola.debug("No provider instances found, setting default priorities")
      return
    }

    // Build priority map from provider instances
    const priorityMap = new Map<string, number>()
    for (const instance of providerInstances) {
      // Use instance-level priority if available, otherwise use provider-level default
      priorityMap.set(instance.provider_id, instance.priority)
    }

    // Set priorities in state
    for (const [providerId, priority] of priorityMap) {
      state.providerPriorities.set(providerId, priority)
    }

    consola.debug(
      "Loaded provider priorities from database:",
      Object.fromEntries(priorityMap),
    )

    // Load model states from database into memory for compatibility
    state.disabledModels.clear()
    for (const instance of providerInstances) {
      const disabledModels = ModelStateStore.getDisabledModels(
        instance.instance_id,
      )
      if (disabledModels.size > 0) {
        state.disabledModels.set(instance.instance_id, disabledModels)
      }
    }

    // Load provider instances
    if (providerInstances.length > 0) {
      await loadProviderInstances(providerInstances)
    }
  } catch (err) {
    consola.warn("Failed to load config from database, using defaults:", err)
    state.providerPriorities.set("github-copilot", 0)
  }
}

async function loadProviderInstances(
  instances: Array<{
    instance_id: string
    provider_id: string
    name: string
    priority: number
    activated: number
  }>,
): Promise<void> {
  const { providerRegistry } = await import("~/providers/registry")

  for (const instance of instances) {
    // Skip if already registered (e.g., from auto-discovery)
    if (providerRegistry.isRegistered(instance.instance_id)) {
      consola.debug(
        `Provider instance already registered: ${instance.instance_id}`,
      )

      // Still need to restore activation state for existing instances
      if (instance.activated === 1) {
        providerRegistry.setActive(instance.instance_id)
      }
      continue
    }

    try {
      let provider
      switch (instance.provider_id) {
        case "github-copilot": {
          const { GitHubCopilotProvider } = await import(
            "~/providers/github-copilot"
          )
          provider = new GitHubCopilotProvider(instance.instance_id)
          provider.name = instance.name
          break
        }
        case "antigravity": {
          const { AntigravityProvider } = await import(
            "~/providers/antigravity"
          )
          provider = new AntigravityProvider(instance.instance_id)
          provider.name = instance.name
          break
        }
        case "alibaba": {
          const { AlibabaProvider } = await import("~/providers/alibaba")
          provider = new AlibabaProvider(instance.instance_id)
          provider.name = instance.name
          break
        }
        case "azure-openai": {
          const { AzureOpenAIProvider } = await import(
            "~/providers/azure-openai"
          )
          provider = new AzureOpenAIProvider(instance.instance_id)
          provider.name = instance.name
          break
        }
        default: {
          consola.warn(
            `Unknown provider type in config: ${instance.provider_id}`,
          )
          continue
        }
      }

      await providerRegistry.register(provider, { saveConfig: false })

      if (instance.activated === 1) {
        providerRegistry.setActive(instance.instance_id)
      }

      consola.debug(
        `Restored provider instance from database: ${instance.instance_id} (activated: ${String(instance.activated)})`,
      )
    } catch (err) {
      consola.warn(
        `Failed to restore provider instance ${instance.instance_id}:`,
        err,
      )
    }
  }
}

export async function saveConfig(): Promise<void> {
  const { providerRegistry } = await import("~/providers/registry")

  try {
    // Save provider instances with activation states and priorities
    const providerMap = providerRegistry.getProviderMap()

    for (const provider of providerMap.values()) {
      const priority = state.providerPriorities.get(provider.instanceId) || 0
      const activated =
        providerRegistry.isActiveProvider(provider.instanceId) ? 1 : 0

      ProviderInstanceStore.save({
        instance_id: provider.instanceId,
        provider_id: provider.id,
        name: provider.name,
        priority,
        activated,
      })
    }

    const instanceCount = providerMap.size
    const activeCount = Array.from(providerMap.values()).filter((p) =>
      providerRegistry.isActiveProvider(p.instanceId),
    ).length

    consola.debug("Saved config to database:", {
      instanceCount,
      activeCount,
      priorities: Object.fromEntries(state.providerPriorities.entries()),
    })
  } catch (err) {
    consola.warn("Failed to save config to database:", err)
  }
}

export function getProviderPriority(providerId: string): number {
  const configValue = ConfigStore.get(`provider_priority_${providerId}`)
  return configValue ? Number.parseInt(configValue, 10) : 0
}

export function setProviderPriority(
  providerId: string,
  priority: number,
): void {
  ConfigStore.set(`provider_priority_${providerId}`, String(priority))
  state.providerPriorities.set(providerId, priority)
}
