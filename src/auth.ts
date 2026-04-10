#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"

import type { ProviderID } from "./providers/types"
import type { Provider } from "./providers/types"

import { ensurePaths, PATHS } from "./lib/paths"
import { state } from "./lib/state"
import { readAlibabaToken, readAntigravityToken } from "./lib/token-db"
import { readAzureOpenAIToken } from "./lib/token-db"
import { AlibabaProvider } from "./providers/alibaba"
import { AntigravityProvider } from "./providers/antigravity"
import { AzureOpenAIProvider } from "./providers/azure-openai"
import { GitHubCopilotProvider } from "./providers/github-copilot"
import { providerRegistry } from "./providers/registry"

// ─── Auto-discovery helpers ──────────────────────────────────────────────────

/**
 * Discovers existing provider instances by checking the database and legacy token files
 */
export async function discoverProviderInstances(): Promise<void> {
  try {
    // First, check if we need to migrate from legacy files
    const { shouldRunMigration, migrateFromFilesToDatabase } = await import(
      "./lib/migration"
    )

    if (await shouldRunMigration()) {
      consola.info("Found legacy token files, migrating to database...")
      await migrateFromFilesToDatabase()
    }

    // Now discover instances from database
    const { ProviderInstanceStore } = await import("./lib/database")
    const instances = ProviderInstanceStore.getAll()

    consola.debug(
      `Found ${instances.length} provider instances in database:`,
      instances.map((i) => i.instance_id),
    )

    for (const instance of instances) {
      // Skip if already registered
      if (providerRegistry.isRegistered(instance.instance_id)) {
        consola.debug(`Already registered: ${instance.instance_id}`)
        continue
      }

      // Create provider based on provider_id
      let provider: Provider | null = null

      switch (instance.provider_id) {
        case "github-copilot": {
          provider = new GitHubCopilotProvider(instance.instance_id)
          provider.name = instance.name
          consola.debug(
            `Created GitHub Copilot provider: ${instance.instance_id}`,
          )

          break
        }
        case "antigravity": {
          provider = new AntigravityProvider(instance.instance_id)
          provider.name = instance.name
          consola.debug(`Created Antigravity provider: ${instance.instance_id}`)

          break
        }
        case "alibaba": {
          provider = new AlibabaProvider(instance.instance_id)
          provider.name = instance.name
          consola.debug(`Created Alibaba provider: ${instance.instance_id}`)

          break
        }
        case "azure-openai": {
          provider = new AzureOpenAIProvider(instance.instance_id)
          provider.name = instance.name
          consola.debug(
            `Created Azure OpenAI provider: ${instance.instance_id}`,
          )

          break
        }
        default: {
          consola.debug(
            `Unknown provider type: ${instance.provider_id} for instance ${instance.instance_id}`,
          )
        }
      }

      if (provider) {
        await providerRegistry.register(provider, { saveConfig: false })

        // Restore activation state
        if (instance.activated === 1) {
          providerRegistry.setActive(instance.instance_id)
        }

        consola.debug(
          `Auto-discovered provider instance: ${instance.instance_id}`,
        )
      }
    }
  } catch (error) {
    consola.debug("Failed to auto-discover provider instances:", error)
  }
}

// ─── Status helpers ───────────────────────────────────────────────────────────

interface ProviderStatus {
  label: string
  authenticated: boolean
  detail: string // shown after the dot
}

async function getGitHubCopilotStatus(): Promise<ProviderStatus> {
  // Check all GitHub Copilot instances
  const instances = providerRegistry.getInstancesOfType("github-copilot")
  if (instances.length === 0) {
    // Check legacy token for backwards compatibility
    const token = await Bun.file(PATHS.GITHUB_TOKEN_PATH)
      .text()
      .catch(() => "")
    const authenticated = token.trim().length > 0
    return {
      label: "GitHub Copilot",
      authenticated,
      detail: authenticated ? "legacy token present" : "not authenticated",
    }
  }

  // Show status of all instances
  let authenticatedCount = 0
  const instanceDetails: Array<string> = []

  for (const instance of instances) {
    const { readGithubToken, readGitHubLogin } = await import("./lib/token-db")
    const token = await readGithubToken(instance.instanceId)
    const login = await readGitHubLogin(instance.instanceId)

    if (token && token.trim().length > 0) {
      authenticatedCount++
      instanceDetails.push(
        login ? `${login} (${instance.instanceId})` : instance.instanceId,
      )
    }
  }

  return {
    label: `GitHub Copilot (${instances.length} instance${instances.length === 1 ? "" : "s"})`,
    authenticated: authenticatedCount > 0,
    detail:
      authenticatedCount > 0 ?
        `${authenticatedCount} authenticated: ${instanceDetails.join(", ")}`
      : `${instances.length} instance${instances.length === 1 ? "" : "s"}, none authenticated`,
  }
}

async function getAntigravityStatus(): Promise<ProviderStatus> {
  const instances = providerRegistry.getInstancesOfType("antigravity")
  if (instances.length === 0) {
    return {
      label: "Antigravity",
      authenticated: false,
      detail: "no instances configured",
    }
  }

  const data = await readAntigravityToken(instances[0].instanceId)
  if (!data) {
    return {
      label: "Antigravity",
      authenticated: false,
      detail: "not authenticated",
    }
  }
  const expired = data.expires_at > 0 && data.expires_at < Date.now()
  let detail: string
  if (expired) {
    detail = `token expired at ${new Date(data.expires_at).toLocaleString()}`
  } else if (data.email) {
    detail = data.email
  } else {
    detail = "authenticated"
  }
  return { label: "Antigravity", authenticated: !expired, detail }
}

async function getAlibabaStatus(): Promise<ProviderStatus> {
  const instances = providerRegistry.getInstancesOfType("alibaba")
  if (instances.length === 0) {
    return {
      label: "Alibaba",
      authenticated: false,
      detail: "no instances configured",
    }
  }

  const data = await readAlibabaToken(instances[0].instanceId)
  if (!data) {
    return {
      label: "Alibaba",
      authenticated: false,
      detail: "not authenticated",
    }
  }
  if (data.auth_type === "api-key") {
    return {
      label: "Alibaba",
      authenticated: true,
      detail: `API key configured`,
    }
  }
  // For OAuth tokens, we need to check expiry (but current token-db.ts only has API key support)
  return {
    label: "Alibaba",
    authenticated: true,
    detail: "authenticated",
  }
}

async function getAzureOpenAIStatus(): Promise<ProviderStatus> {
  // Check the first Azure OpenAI instance for status
  const instances = providerRegistry.getInstancesOfType("azure-openai")
  if (instances.length === 0) {
    return {
      label: "Azure OpenAI",
      authenticated: false,
      detail: "no instances configured",
    }
  }

  // Check the first instance
  const data = await readAzureOpenAIToken(instances[0].instanceId)
  if (!data) {
    return {
      label: "Azure OpenAI",
      authenticated: false,
      detail: "not authenticated",
    }
  }
  return {
    label: "Azure OpenAI",
    authenticated: true,
    detail: `${data.resource_name} · ${data.api_version}`,
  }
}

function printStatus(statuses: Array<ProviderStatus>): void {
  consola.log("")
  for (const s of statuses) {
    const dot = s.authenticated ? "\x1b[32m●\x1b[0m" : "\x1b[31m●\x1b[0m"
    consola.log(`  ${dot}  ${s.label.padEnd(20)} ${s.detail}`)
  }
  consola.log("")
}

async function getAllStatuses(): Promise<Array<ProviderStatus>> {
  return Promise.all([
    getGitHubCopilotStatus(),
    getAntigravityStatus(),
    getAlibabaStatus(),
    getAzureOpenAIStatus(),
  ])
}

// ─── Auth status subcommand ───────────────────────────────────────────────────

export const authStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show authentication status for all providers",
  },
  async run() {
    await ensurePaths()

    // Load config and discover provider instances from database
    const { loadConfig } = await import("~/lib/config-db")
    await loadConfig()
    await discoverProviderInstances()

    const statuses = await getAllStatuses()
    printStatus(statuses)
    process.exit(0)
  },
})

// ─── Interactive login flow ───────────────────────────────────────────────────

async function runLogin(options: {
  verbose: boolean
  showToken: boolean
  provider?: string
}): Promise<void> {
  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.showToken = options.showToken

  await ensurePaths()

  // Load config (including saved provider instances) before discovery
  const { loadConfig } = await import("~/lib/config-db")
  await loadConfig()

  // Auto-discover existing provider instances from providers folder
  await discoverProviderInstances()

  // No need to register default placeholders anymore - users can add providers via the UI

  // Show current status before prompting
  const statuses = await getAllStatuses()
  printStatus(statuses)

  let providerId = options.provider
  if (!providerId) {
    // Build dynamic options for all provider instances
    const githubInstances =
      providerRegistry.getInstancesOfType("github-copilot")
    const antigravityInstances =
      providerRegistry.getInstancesOfType("antigravity")
    const alibabaInstances = providerRegistry.getInstancesOfType("alibaba")

    const providerOptions = []

    // GitHub Copilot instances
    for (const instance of githubInstances) {
      const { readGitHubLogin } = await import("./lib/token-db")
      const login = await readGitHubLogin(instance.instanceId)
      const isAuthenticated = statuses[0]?.authenticated && login
      const label =
        login ?
          `GitHub Copilot (${login})${isAuthenticated ? " ✓" : ""}`
        : `GitHub Copilot${isAuthenticated ? " ✓" : ""}`

      providerOptions.push({
        label,
        value: instance.instanceId,
      })
    }

    // Add option to create new GitHub instance
    providerOptions.push({
      label: "🆕 Add new GitHub Copilot account",
      value: "new-github-copilot",
    })

    // Antigravity instances
    for (const instance of antigravityInstances) {
      const isAuthenticated = statuses[1]?.authenticated
      providerOptions.push({
        label: `Antigravity${isAuthenticated ? " ✓ already authenticated" : ""}`,
        value: instance.instanceId,
      })
    }

    // Alibaba instances
    for (const instance of alibabaInstances) {
      const isAuthenticated = statuses[2]?.authenticated
      providerOptions.push({
        label: `Alibaba (DashScope/Qwen)${isAuthenticated ? " ✓ already authenticated" : ""}`,
        value: instance.instanceId,
      })
    }

    // Azure OpenAI instances
    const azureInstances = providerRegistry.getInstancesOfType("azure-openai")
    for (const instance of azureInstances) {
      const isAuthenticated = statuses[3]?.authenticated
      providerOptions.push({
        label: `Azure OpenAI${isAuthenticated ? " ✓ already authenticated" : ""}`,
        value: instance.instanceId,
      })
    }

    // If no providers exist, offer to add them
    if (providerOptions.length === 0) {
      providerOptions.push(
        { label: "🆕 Add GitHub Copilot", value: "new-github-copilot" },
        { label: "🆕 Add Antigravity", value: "new-antigravity" },
        { label: "🆕 Add Alibaba", value: "new-alibaba" },
        { label: "🆕 Add Azure OpenAI", value: "new-azure-openai" },
      )
    }

    providerId = await consola.prompt(
      "Select a provider to authenticate with",
      {
        type: "select",
        options: providerOptions,
      },
    )
  }

  // Handle creating new provider instances
  switch (providerId) {
    case "new-github-copilot": {
      const instanceId = providerRegistry.nextInstanceId("github-copilot")
      const newProvider = new GitHubCopilotProvider(instanceId)
      await providerRegistry.register(newProvider)
      providerId = instanceId
      consola.info(`Created new GitHub Copilot instance: ${instanceId}`)

      break
    }
    case "new-antigravity": {
      const instanceId = providerRegistry.nextInstanceId("antigravity")
      const newProvider = new AntigravityProvider(instanceId)
      await providerRegistry.register(newProvider)
      providerId = instanceId
      consola.info(`Created new Antigravity instance: ${instanceId}`)

      break
    }
    case "new-alibaba": {
      const instanceId = providerRegistry.nextInstanceId("alibaba")
      const newProvider = new AlibabaProvider(instanceId)
      await providerRegistry.register(newProvider)
      providerId = instanceId
      consola.info(`Created new Alibaba instance: ${instanceId}`)

      break
    }
    case "new-azure-openai": {
      const instanceId = providerRegistry.nextInstanceId("azure-openai")
      const newProvider = new AzureOpenAIProvider(instanceId)
      await providerRegistry.register(newProvider)
      providerId = instanceId
      consola.info(`Created new Azure OpenAI instance: ${instanceId}`)

      break
    }
    // No default
  }

  const provider = providerRegistry.getProvider(providerId as ProviderID)
  providerRegistry.setActive(providerId as ProviderID)
  state.currentProvider = provider
  state.selectedProviderID = providerId as ProviderID

  consola.info(`Authenticating with ${provider.name}...`)
  await provider.setupAuth({ force: true })
  consola.success(`${provider.name} authentication saved`)
  process.exit(0)
}

// ─── Auth command (with status subcommand) ────────────────────────────────────

const authLogin = defineCommand({
  meta: {
    name: "login",
    description: "Authenticate with a provider (interactive)",
  },
  args: {
    provider: {
      type: "string",
      description:
        "Provider to authenticate with (github-copilot, antigravity, alibaba). Omit to get an interactive menu.",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show token on auth",
    },
  },
  run({ args }) {
    return runLogin({
      verbose: args.verbose,
      showToken: args["show-token"],
      provider: args.provider || undefined,
    })
  },
})

export const auth = defineCommand({
  meta: {
    name: "auth",
    description:
      "Manage provider authentication. Run without a subcommand to log in interactively.",
  },
  args: {
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show token on auth",
    },
  },
  subCommands: {
    status: authStatus,
    login: authLogin,
  },
  run({ args, rawArgs }) {
    // citty always calls parent run even after routing to a subcommand,
    // so skip if a known subcommand was already handled.
    const subCommandNames = new Set(["status", "login"])
    if (rawArgs.some((a) => subCommandNames.has(a))) return
    // Default: interactive login flow (same as `auth login`)
    return runLogin({
      verbose: args.verbose,
      showToken: args["show-token"],
    })
  },
})
