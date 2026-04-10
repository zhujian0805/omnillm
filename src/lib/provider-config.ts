import consola from "consola"

import { ProviderConfigStore } from "./database"

// Provider configuration interfaces (separate from authentication)
export interface AzureOpenAIConfig {
  endpoint: string
  api_version: string
  resource_name: string
  deployments: Array<string>
}

export interface AlibabaConfig {
  base_url: string
  region: "global" | "china"
}

// Generic config operations
export function getProviderConfig<T>(instanceId: string): T | null {
  try {
    return ProviderConfigStore.getConfig<T>(instanceId)
  } catch (error) {
    consola.warn(`Failed to get provider config for ${instanceId}:`, error)
    return null
  }
}

export function saveProviderConfig(instanceId: string, config: object): void {
  try {
    ProviderConfigStore.save(instanceId, config)
    consola.debug(`Saved provider config for ${instanceId}`)
  } catch (error) {
    consola.error(`Failed to save provider config for ${instanceId}:`, error)
    throw error
  }
}

export function deleteProviderConfig(instanceId: string): void {
  try {
    ProviderConfigStore.delete(instanceId)
    consola.debug(`Deleted provider config for ${instanceId}`)
  } catch (error) {
    consola.warn(`Failed to delete provider config for ${instanceId}:`, error)
    throw error
  }
}

// Azure OpenAI specific functions
export function getAzureOpenAIConfig(
  instanceId: string,
): AzureOpenAIConfig | null {
  return getProviderConfig<AzureOpenAIConfig>(instanceId)
}

export function saveAzureOpenAIConfig(
  instanceId: string,
  config: AzureOpenAIConfig,
): void {
  saveProviderConfig(instanceId, config)
}

// Alibaba specific functions
export function getAlibabaConfig(instanceId: string): AlibabaConfig | null {
  return getProviderConfig<AlibabaConfig>(instanceId)
}

export function saveAlibabaConfig(
  instanceId: string,
  config: AlibabaConfig,
): void {
  saveProviderConfig(instanceId, config)
}
