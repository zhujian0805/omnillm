import consola from "consola"

import { ConfigStore, ProviderInstanceStore, TokenStore } from "./database"
import { PATHS } from "./paths"

interface LegacyConfig {
  providerPriorities?: Record<string, number>
  providerInstances?: Array<{
    id: string
    instanceId: string
    name: string
    activated: 0 | 1
  }>
}

interface GitHubTokenData {
  token: string
  login: string
}

interface AzureOpenAITokenData {
  auth_type: "api-key"
  api_key: string
  endpoint: string
  api_version: string
  resource_name: string
  deployments: Array<string>
}

interface AntigravityTokenData {
  auth_type: "api-key"
  api_key: string
}

interface AlibabaTokenData {
  auth_type: "api-key"
  api_key: string
}

export async function migrateFromFilesToDatabase(): Promise<void> {
  consola.info(
    "Starting migration from file-based storage to SQLite database...",
  )

  let migratedConfigs = 0
  let migratedInstances = 0
  let migratedTokens = 0

  // 1. Migrate config.json
  try {
    const configFile = Bun.file(PATHS.CONFIG_FILE)
    if (await configFile.exists()) {
      const config = (await configFile.json()) as LegacyConfig

      // Migrate provider priorities
      if (config.providerPriorities) {
        for (const [providerId, priority] of Object.entries(
          config.providerPriorities,
        )) {
          ConfigStore.set(`provider_priority_${providerId}`, String(priority))
          migratedConfigs++
        }
        consola.debug(
          `Migrated ${Object.keys(config.providerPriorities).length} provider priorities`,
        )
      }

      // Migrate provider instances
      if (config.providerInstances) {
        for (const instance of config.providerInstances) {
          // Skip if already in DB — don't resurrect instances the user deleted
          if (ProviderInstanceStore.get(instance.instanceId)) continue

          // Find actual priority from priorities map or use default
          const priority = config.providerPriorities?.[instance.id] || 0

          ProviderInstanceStore.save({
            instance_id: instance.instanceId,
            provider_id: instance.id,
            name: instance.name,
            priority,
            activated: instance.activated,
          })
          migratedInstances++
        }
        consola.debug(
          `Migrated ${config.providerInstances.length} provider instances`,
        )
      }
    }
  } catch (error) {
    consola.warn("Failed to migrate config.json:", error)
  }

  // 2. Migrate token files from providers directory
  try {
    const providersDir = Bun.file(PATHS.PROVIDERS_DIR)
    if (await providersDir.exists()) {
      // Get all token files in providers directory
      const files = await Bun.$`ls ${PATHS.PROVIDERS_DIR}`.text()
      const tokenFiles = files
        .split("\n")
        .filter((f) => f.trim().endsWith("_token"))
        .map((f) => f.trim())

      for (const tokenFile of tokenFiles) {
        const instanceId = tokenFile.replace("_token", "")
        const tokenPath = `${PATHS.PROVIDERS_DIR}/${tokenFile}`

        try {
          const file = Bun.file(tokenPath)
          if (await file.exists()) {
            const tokenText = await file.text()
            if (!tokenText.trim()) continue

            // Determine provider type from instance ID
            let providerId: string
            let tokenData: unknown

            if (instanceId.startsWith("github-copilot")) {
              providerId = "github-copilot"
              try {
                tokenData = JSON.parse(tokenText) as GitHubTokenData
              } catch {
                // Legacy raw token format
                tokenData = { token: tokenText.trim(), login: "user" }
              }
            } else if (instanceId.startsWith("azure-openai")) {
              providerId = "azure-openai"
              tokenData = JSON.parse(tokenText) as AzureOpenAITokenData
            } else if (instanceId.startsWith("antigravity")) {
              providerId = "antigravity"
              tokenData = JSON.parse(tokenText) as AntigravityTokenData
            } else if (instanceId.startsWith("alibaba")) {
              providerId = "alibaba"
              tokenData = JSON.parse(tokenText) as AlibabaTokenData
            } else {
              consola.warn(`Unknown provider type for instance: ${instanceId}`)
              continue
            }

            TokenStore.save(instanceId, providerId, tokenData as object)
            migratedTokens++
            consola.debug(`Migrated token for instance: ${instanceId}`)
          }
        } catch (error) {
          consola.warn(`Failed to migrate token for ${instanceId}:`, error)
        }
      }
    }
  } catch (error) {
    consola.warn("Failed to migrate token files:", error)
  }

  // 3. Migrate legacy GitHub token if it exists
  try {
    const legacyTokenFile = Bun.file(PATHS.GITHUB_TOKEN_PATH)
    if (await legacyTokenFile.exists()) {
      const token = (await legacyTokenFile.text()).trim()
      if (token) {
        let login = "user" // default

        // Try to read legacy user file
        const legacyUserFile = Bun.file(PATHS.GITHUB_USER_PATH)
        if (await legacyUserFile.exists()) {
          login = (await legacyUserFile.text()).trim() || "user"
        }

        const instanceId = `github-copilot-${login.toLowerCase()}`
        const tokenData: GitHubTokenData = { token, login }

        TokenStore.save(instanceId, "github-copilot", tokenData)

        // Also add instance record if it doesn't exist
        if (!ProviderInstanceStore.get(instanceId)) {
          ProviderInstanceStore.save({
            instance_id: instanceId,
            provider_id: "github-copilot",
            name: `GitHub Copilot (${login})`,
            priority: 0,
            activated: 1, // Assume it was active if token exists
          })
          migratedInstances++
        }

        migratedTokens++
        consola.debug(`Migrated legacy GitHub token for user: ${login}`)
      }
    }
  } catch (error) {
    consola.warn("Failed to migrate legacy GitHub token:", error)
  }

  consola.success(
    `Migration completed: ${migratedConfigs} configs, ${migratedInstances} instances, ${migratedTokens} tokens`,
  )

  // Remove legacy files so migration does not re-run on next restart
  await cleanupLegacyFiles()
}

export async function shouldRunMigration(): Promise<boolean> {
  // Check if we have any legacy files to migrate
  const checks = await Promise.all([
    // Check for config.json
    Bun.file(PATHS.CONFIG_FILE).exists(),
    // Check for legacy GitHub token
    Bun.file(PATHS.GITHUB_TOKEN_PATH).exists(),
    // Check for any provider token files
    checkForProviderTokens(),
  ])

  return checks.some(Boolean)
}

async function checkForProviderTokens(): Promise<boolean> {
  try {
    const providersDir = Bun.file(PATHS.PROVIDERS_DIR)
    if (!(await providersDir.exists())) return false

    const files = await Bun.$`ls ${PATHS.PROVIDERS_DIR}`.text()
    const tokenFiles = files
      .split("\n")
      .filter((f) => f.trim().endsWith("_token"))
      .filter((f) => f.trim().length > 0)

    return tokenFiles.length > 0
  } catch {
    return false
  }
}

export async function cleanupLegacyFiles(): Promise<void> {
  consola.info("Cleaning up legacy configuration files...")

  const filesToRemove = [
    PATHS.CONFIG_FILE,
    PATHS.GITHUB_TOKEN_PATH,
    PATHS.GITHUB_USER_PATH,
  ]

  let removedFiles = 0

  for (const filePath of filesToRemove) {
    try {
      const file = Bun.file(filePath)
      if (await file.exists()) {
        // Use fs to delete the file cross-platform
        const fs = await import("node:fs/promises")
        await fs.unlink(filePath)
        consola.debug(`Removed: ${filePath}`)
        removedFiles++
      }
    } catch (error) {
      consola.warn(`Failed to remove ${filePath}:`, error)
    }
  }

  // Clean up providers directory token files
  try {
    const providersDir = Bun.file(PATHS.PROVIDERS_DIR)
    if (await providersDir.exists()) {
      const files = await Bun.$`ls ${PATHS.PROVIDERS_DIR}`.text()
      const tokenFiles = files
        .split("\n")
        .filter((f) => f.trim().endsWith("_token"))
        .filter((f) => f.trim().length > 0)

      for (const tokenFile of tokenFiles) {
        const tokenPath = `${PATHS.PROVIDERS_DIR}/${tokenFile}`
        try {
          const fs = await import("node:fs/promises")
          await fs.unlink(tokenPath)
          consola.debug(`Removed token file: ${tokenPath}`)
          removedFiles++
        } catch (error) {
          consola.warn(`Failed to remove token file ${tokenPath}:`, error)
        }
      }

      // Remove providers directory if it's empty
      try {
        const remainingFiles = await Bun.$`ls ${PATHS.PROVIDERS_DIR}`.text()
        if (!remainingFiles.trim()) {
          const fs = await import("node:fs/promises")
          await fs.rmdir(PATHS.PROVIDERS_DIR)
          consola.debug(
            `Removed empty providers directory: ${PATHS.PROVIDERS_DIR}`,
          )
        }
      } catch (error) {
        consola.debug(
          "Providers directory not empty or couldn't be removed:",
          error,
        )
      }
    }
  } catch (error) {
    consola.warn("Failed to clean up providers directory:", error)
  }

  consola.success(`Cleaned up ${removedFiles} legacy files`)
}
