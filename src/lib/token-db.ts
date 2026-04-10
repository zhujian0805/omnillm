import consola from "consola"

import type { ProviderID } from "~/providers/types"

import { TokenStore } from "./database"

// Token data interfaces for different providers
export interface GitHubTokenData {
  token: string
  login: string
}

export interface AzureOpenAITokenData {
  auth_type: "api-key"
  api_key: string
  endpoint: string
  api_version: string
  resource_name: string
  deployments: Array<string>
}

export interface AntigravityTokenData {
  access_token: string
  refresh_token: string
  expires_at: number // unix timestamp (ms)
  email?: string
  project_id?: string
  client_id?: string
  client_secret?: string
}

export interface AlibabaTokenData {
  auth_type: "oauth" | "api-key"
  access_token: string
  // OAuth fields
  refresh_token: string
  resource_url: string // base URL override from OAuth token response
  expires_at: number // unix timestamp (ms); 0 for api-key (never expires)
  // API key fields
  base_url: string // explicit base URL for api-key auth
}

// Generic token operations
export function getTokenData<T>(instanceId: string): T | null {
  try {
    const record = TokenStore.get(instanceId)
    if (!record) return null

    return JSON.parse(record.token_data) as T
  } catch (error) {
    consola.warn(`Failed to get token data for ${instanceId}:`, error)
    return null
  }
}

export function saveTokenData(
  instanceId: string,
  providerId: ProviderID,
  tokenData: object,
): void {
  try {
    TokenStore.save(instanceId, providerId, tokenData)
    consola.debug(`Saved token data for ${instanceId}`)
  } catch (error) {
    consola.error(`Failed to save token data for ${instanceId}:`, error)
    throw error
  }
}

export function deleteTokenData(instanceId: string): void {
  try {
    TokenStore.delete(instanceId)
    consola.debug(`Deleted token data for ${instanceId}`)
  } catch (error) {
    consola.warn(`Failed to delete token data for ${instanceId}:`, error)
    throw error
  }
}

// GitHub Copilot specific functions
export async function readGithubToken(instanceId: string): Promise<string> {
  const tokenData = await getTokenData<GitHubTokenData>(instanceId)
  return tokenData?.token || ""
}

export async function writeGithubToken(
  token: string,
  login: string,
  instanceId: string,
): Promise<void> {
  const tokenData: GitHubTokenData = { token, login }
  await saveTokenData(instanceId, "github-copilot", tokenData)
}

export async function readGitHubLogin(
  instanceId: string,
): Promise<string | null> {
  const tokenData = await getTokenData<GitHubTokenData>(instanceId)
  return tokenData?.login || null
}

// Azure OpenAI specific functions
export async function readAzureOpenAIToken(
  instanceId: string,
): Promise<AzureOpenAITokenData | null> {
  return getTokenData<AzureOpenAITokenData>(instanceId)
}

export async function writeAzureOpenAIToken(
  data: AzureOpenAITokenData,
  instanceId: string,
): Promise<void> {
  await saveTokenData(instanceId, "azure-openai", data)
}

// Antigravity specific functions
export async function readAntigravityToken(
  instanceId: string,
): Promise<AntigravityTokenData | null> {
  return getTokenData<AntigravityTokenData>(instanceId)
}

export async function writeAntigravityToken(
  data: AntigravityTokenData,
  instanceId: string,
): Promise<void> {
  await saveTokenData(instanceId, "antigravity", data)
}

// Alibaba specific functions
export async function readAlibabaToken(
  instanceId: string,
): Promise<AlibabaTokenData | null> {
  return getTokenData<AlibabaTokenData>(instanceId)
}

export async function writeAlibabaToken(
  data: AlibabaTokenData,
  instanceId: string,
): Promise<void> {
  await saveTokenData(instanceId, "alibaba", data)
}

// Utility functions
export async function getAllTokensByProvider(providerId: ProviderID): Promise<
  Array<{
    instanceId: string
    tokenData: unknown
  }>
> {
  try {
    const records = TokenStore.getAllByProvider(providerId)
    return records.map((record) => ({
      instanceId: record.instance_id,
      tokenData: JSON.parse(record.token_data),
    }))
  } catch (error) {
    consola.warn(`Failed to get tokens for provider ${providerId}:`, error)
    return []
  }
}

export async function hasValidToken(instanceId: string): Promise<boolean> {
  const record = TokenStore.get(instanceId)
  if (!record) return false

  try {
    const tokenData = JSON.parse(record.token_data)

    // Basic validation based on provider type
    if (record.provider_id === "github-copilot") {
      const data = tokenData as GitHubTokenData
      return Boolean(data.token && data.login)
    }

    if (record.provider_id === "azure-openai") {
      const data = tokenData as AzureOpenAITokenData
      return Boolean(data.api_key && data.endpoint)
    }

    if (record.provider_id === "antigravity") {
      const data = tokenData as AntigravityTokenData
      return Boolean(data.access_token && data.refresh_token)
    }

    if (record.provider_id === "alibaba") {
      const data = tokenData as AlibabaTokenData
      return Boolean(data.access_token)
    }

    return true
  } catch {
    return false
  }
}
