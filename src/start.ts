#!/usr/bin/env node

import { defineCommand } from "citty"
import clipboard from "clipboardy"
import consola from "consola"
import { serve } from "srvx"

import { loadConfig } from "./lib/config-db"
import { setupFileLogging, setLogLevel } from "./lib/logging"
import { selectModelWithFilter } from "./lib/model-selection"
import { ensurePaths } from "./lib/paths"
import { initProxyFromEnv } from "./lib/proxy"
import { generateEnvScript } from "./lib/shell"
import { state } from "./lib/state"
import { cacheVSCodeVersion } from "./lib/utils"
import { server } from "./server"

interface RunServerOptions {
  port: number
  verbose: boolean
  accountType: string
  manual: boolean
  rateLimit?: number
  rateLimitWait: boolean
  githubToken?: string
  claudeCode: boolean
  console: boolean
  showToken: boolean
  proxyEnv: boolean
  provider: string
}

/**
 * Initialize providers with auto-discovery but don't auto-activate them
 */
async function initializeProviders(
  _selectedProviderType: string,
): Promise<void> {
  // Load config (including saved provider instances) before discovery
  const { loadConfig } = await import("./lib/config-db")
  await loadConfig()

  // Import auto-discovery function
  const { discoverProviderInstances } = await import("./auth")

  // Auto-discover existing provider instances from providers folder
  await discoverProviderInstances()

  // No need to register default placeholders - users can add providers via the UI

  // Active providers are restored from config via loadConfig()
  consola.info("Providers initialized. Activation states restored from config.")
}

/**
 * Handle Claude Code setup and command generation
 */
async function handleClaudeCodeSetup(port: number): Promise<void> {
  // For Claude Code mode, we need models to be available
  // Check if we have any active providers and try to load models
  const { providerRegistry } = await import("./providers/registry")
  const activeProviders = providerRegistry.getActiveProviders()

  if (activeProviders.length === 0) {
    consola.warn(
      "No active providers found. You can add and activate providers through the admin UI at http://localhost:PORT/admin",
    )
    consola.info(
      "The proxy will still start, but you'll need to configure providers before making requests.",
    )
    return // Don't exit, just continue without models
  }

  // Try to load models from the first active provider
  const provider = activeProviders[0]
  try {
    consola.info(
      `Loading models from ${provider.name} for Claude Code setup...`,
    )
    const providerModels = await provider.getModels()
    state.models = providerModels
    consola.info(`Loaded ${providerModels.data.length} models`)
  } catch (error) {
    consola.error(`Failed to load models from ${provider.name}:`, error)
    consola.error("Please ensure the provider is properly authenticated.")
    process.exit(1)
  }

  const selectedModel = await selectModelWithFilter(
    state.models.data.map((model) => ({ id: model.id, name: model.name })),
    "Select a model to use with Claude Code",
  )

  const selectedSmallModel = await selectModelWithFilter(
    state.models.data.map((model) => ({ id: model.id, name: model.name })),
    "Select a small model to use with Claude Code",
  )

  const serverUrl = `http://localhost:${port}`
  const command = generateEnvScript(
    {
      ANTHROPIC_BASE_URL: serverUrl,
      ANTHROPIC_AUTH_TOKEN: "dummy",
      ANTHROPIC_MODEL: selectedModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: selectedModel,
      ANTHROPIC_SMALL_FAST_MODEL: selectedSmallModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: selectedSmallModel,
      DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
    "claude",
  )

  try {
    clipboard.writeSync(command)
    consola.success("Copied Claude Code command to clipboard!")
  } catch {
    consola.warn("Failed to copy to clipboard")
  }

  consola.info(`\n${command}`)
}

/**
 * Handle interactive console mode
 */
async function handleConsoleMode(port: number): Promise<void> {
  const readline = await import("node:readline/promises")
  const stdin = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const serverUrl = `http://localhost:${port}`
  consola.info(`\nInteractive mode. ${serverUrl}/chat/completions`)
  consola.info('Type "exit" to quit.\n')

  while (true) {
    const prompt = await stdin.question("Prompt: ")
    if (prompt.trim().toLowerCase() === "exit") break

    try {
      const response = await fetch(`${serverUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: state.models?.data[0]?.id || "unknown",
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      })

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = data.choices?.[0]?.message?.content
      if (content) {
        consola.info(`Response: ${content}\n`)
      } else {
        consola.error("No response content")
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error"
      consola.error("Error:", errorMessage)
    }
  }

  stdin.close()
}
export async function runServer(options: RunServerOptions): Promise<void> {
  // Set up file logging first
  setupFileLogging()

  if (options.proxyEnv) {
    initProxyFromEnv()
  }

  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.accountType = options.accountType
  if (options.accountType !== "individual") {
    consola.info(`Using ${options.accountType} plan GitHub account`)
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait
  state.showToken = options.showToken

  await ensurePaths()
  await loadConfig()

  // Apply persisted log level now that DB is available
  try {
    const { ConfigStore } = await import("./lib/database")
    const saved = ConfigStore.get("log_level")
    if (saved !== null) {
      setLogLevel(Number.parseInt(saved))
    }
  } catch {
    // ignore if DB unavailable
  }

  // Initialize providers (discovery and registration only)
  await initializeProviders(options.provider)

  // Cache VSCode version if needed (doesn't require auth)
  if (options.provider === "github-copilot") {
    await cacheVSCodeVersion()
  }

  // That's it! No authentication, no model fetching during startup
  // All of that happens when users click "Activate" in the UI

  if (options.claudeCode) {
    await handleClaudeCodeSetup(options.port)
    return
  }

  if (options.console) {
    await handleConsoleMode(options.port)
    return
  }

  const serverUrl = `http://localhost:${options.port}`
  const adminUrl = `${serverUrl}/admin`
  state.port = options.port

  serve({
    fetch: server.fetch,
    port: options.port,
    onListen: () => {
      state.port = options.port
      consola.info(`🚀 Server running at ${serverUrl}`)
      consola.info(`📱 Admin UI at ${adminUrl}`)
    },
  })
}

export const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the LLM proxy server",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port to listen on",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type to use (individual, business, enterprise)",
    },
    manual: {
      type: "boolean",
      default: false,
      description: "Enable manual request approval",
    },
    "rate-limit": {
      alias: "r",
      type: "string",
      description: "Rate limit in seconds between requests",
    },
    wait: {
      alias: "w",
      type: "boolean",
      default: false,
      description:
        "Wait instead of error when rate limit is hit. Has no effect if rate limit is not set",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token directly (must be generated using the `auth` subcommand)",
    },
    "claude-code": {
      alias: "c",
      type: "boolean",
      default: false,
      description: "Generate a command to launch Claude Code with proxy config",
    },
    console: {
      type: "boolean",
      default: false,
      description:
        "Automatically open the admin console in your default browser",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show tokens on fetch and refresh",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
    provider: {
      type: "string",
      default: "github-copilot",
      description:
        "Provider to use (github-copilot, antigravity, alibaba, etc.)",
    },
  },
  run({ args }) {
    const rateLimitRaw = args["rate-limit"]
    const rateLimit =
      rateLimitRaw ? Number.parseInt(rateLimitRaw, 10) : undefined

    return runServer({
      port: Number.parseInt(args.port, 10),
      verbose: args.verbose,
      accountType: args["account-type"],
      manual: args.manual,
      rateLimit,
      rateLimitWait: args.wait,
      githubToken: args["github-token"],
      claudeCode: args["claude-code"],
      console: args.console,
      showToken: args["show-token"],
      proxyEnv: args["proxy-env"],
      provider: args.provider,
    })
  },
})
