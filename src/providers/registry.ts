import consola from "consola"

import type { Provider, ProviderID } from "./types"

class ProviderRegistry {
  private providers = new Map<string, Provider>()
  private activeProvider: Provider | null = null
  private activeProviders = new Set<string>()

  async register(
    provider: Provider,
    options?: { saveConfig?: boolean },
  ): Promise<void> {
    this.providers.set(provider.instanceId, provider)
    if (options?.saveConfig === false) return
    try {
      const { saveConfig } = await import("~/lib/config-db")
      await saveConfig()
    } catch (err) {
      consola.warn("Failed to save config after provider registration:", err)
    }
  }

  getProvider(instanceId: string): Provider {
    const provider = this.providers.get(instanceId)
    if (!provider) {
      throw new Error(
        `Provider '${instanceId}' not found. Available: ${Array.from(this.providers.keys()).join(", ")}`,
      )
    }
    return provider
  }

  setActive(instanceId: string): Provider {
    const provider = this.getProvider(instanceId)
    this.activeProvider = provider
    this.activeProviders.add(instanceId)
    // Save config when activation state changes
    this.saveConfigAsync()
    return provider
  }

  getActive(): Provider {
    if (!this.activeProvider) {
      throw new Error("No active provider set")
    }
    return this.activeProvider
  }

  addActive(instanceId: string): Provider {
    const provider = this.getProvider(instanceId)
    this.activeProviders.add(instanceId)
    if (!this.activeProvider) {
      this.activeProvider = provider
    }
    // Save config when activation state changes
    this.saveConfigAsync()
    return provider
  }

  removeActive(instanceId: string): void {
    this.activeProviders.delete(instanceId)
    if (this.activeProvider?.instanceId === instanceId) {
      // Pick another active provider as the primary, or null
      const remaining = Array.from(this.activeProviders)
      this.activeProvider =
        remaining.length > 0 ? this.getProvider(remaining[0]) : null
    }
    // Save config when activation state changes
    this.saveConfigAsync()
  }

  getActiveProviders(): Array<Provider> {
    return Array.from(this.activeProviders)
      .filter((id) => this.providers.has(id))
      .map((id) => {
        const provider = this.providers.get(id)
        if (!provider) {
          throw new Error(`Active provider ${id} not found in registry`)
        }
        return provider
      })
  }

  isActiveProvider(instanceId: string): boolean {
    return this.activeProviders.has(instanceId)
  }

  listProviders(): Array<Provider> {
    return Array.from(this.providers.values())
  }

  isRegistered(instanceId: string): boolean {
    return this.providers.has(instanceId)
  }

  getProviderMap(): ReadonlyMap<string, Provider> {
    return this.providers
  }

  /** Re-register a provider under a new instanceId (e.g. after identity is known post-auth) */
  async rename(oldInstanceId: string, newInstanceId: string): Promise<boolean> {
    const provider = this.providers.get(oldInstanceId)
    if (!provider) return false

    // Check if target instanceId already exists
    if (this.providers.has(newInstanceId)) {
      consola.warn(
        `Cannot rename ${oldInstanceId} to ${newInstanceId}: target already exists`,
      )
      return false
    }

    this.providers.delete(oldInstanceId)
    this.providers.set(newInstanceId, provider)
    if (this.activeProviders.has(oldInstanceId)) {
      this.activeProviders.delete(oldInstanceId)
      this.activeProviders.add(newInstanceId)
    }
    if (this.activeProvider?.instanceId === newInstanceId) {
      // already updated since provider object mutated in place
    }
    // Save config after renaming
    try {
      const { saveConfig } = await import("~/lib/config-db")
      await saveConfig()
    } catch (err) {
      consola.warn("Failed to save config after provider rename:", err)
    }
    return true
  }

  /** Remove a provider instance and clean up its token file */
  async remove(instanceId: string): Promise<boolean> {
    const provider = this.providers.get(instanceId)
    if (!provider) return false

    // Remove from registry
    this.providers.delete(instanceId)

    // Remove from active providers
    if (this.activeProviders.has(instanceId)) {
      this.removeActive(instanceId)
    }

    // Clean up token file
    try {
      const { deleteTokenData } = await import("~/lib/token-db")
      await deleteTokenData(instanceId)
    } catch (err) {
      consola.warn(`Failed to clean up token for ${instanceId}:`, err)
    }

    // Save config after removal
    try {
      const { saveConfig } = await import("~/lib/config-db")
      await saveConfig()
    } catch (err) {
      consola.warn("Failed to save config after provider removal:", err)
    }

    return true
  }

  /** Return all registered instances of a given provider type */
  getInstancesOfType(id: ProviderID): Array<Provider> {
    return Array.from(this.providers.values()).filter((p) => p.id === id)
  }

  /** Generate a new unique instance ID for the given provider type */
  nextInstanceId(id: ProviderID): string {
    const existing = this.getInstancesOfType(id)
    // First instance keeps the plain ID, subsequent ones get unique suffixes
    if (existing.length === 0) return id

    // For providers that use username-based IDs (like GitHub Copilot),
    // we need to avoid conflicts with existing instances
    let counter = 2
    let candidateId: string
    do {
      candidateId = `${id}-${counter}`
      counter++
    } while (this.isRegistered(candidateId))

    return candidateId
  }

  /** Helper to save config asynchronously without blocking */
  private saveConfigAsync(): void {
    import("~/lib/config-db")
      .then(({ saveConfig }) => {
        saveConfig().catch((err: unknown) => {
          consola.warn(
            "Failed to auto-save config after provider state change:",
            err,
          )
        })
      })
      .catch((err: unknown) => {
        consola.warn("Failed to import config module:", err)
      })
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry()
