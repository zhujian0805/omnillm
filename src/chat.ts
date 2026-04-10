#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"
import { events } from "fetch-event-stream"
import { createInterface } from "node:readline"

import type { Provider } from "./providers/types"
import type { ProviderID } from "./providers/types"

import { parseOpenAIChatCompletions } from "./ingestion/from-openai"
import { selectModelWithFilter } from "./lib/model-selection"
import { ensurePaths, PATHS } from "./lib/paths"
import { readAlibabaToken } from "./providers/alibaba/auth"
import { readAntigravityToken } from "./providers/antigravity/auth"
import { providerRegistry } from "./providers/registry"
import { canonicalRequestToChatCompletionsPayload } from "./serialization/to-openai-payload"

// ─── Readline prompt ─────────────────────────────────────────────────────────

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })
    rl.question("> ", (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

// ─── Status helpers ──────────────────────────────────────────────────────────

interface ProviderStatus {
  id: ProviderID
  label: string
  authenticated: boolean
}

async function getProviderStatuses(): Promise<Array<ProviderStatus>> {
  const ghRaw = await Bun.file(PATHS.GITHUB_TOKEN_PATH)
    .text()
    .catch(() => "")
  const ghAuth = ghRaw.trim().length > 0

  const antigravityToken = await readAntigravityToken()
  const antigravityAuth =
    antigravityToken !== null
    && (antigravityToken.expires_at <= 0
      || antigravityToken.expires_at >= Date.now())

  const alibabaToken = await readAlibabaToken()
  const alibabaAuth =
    alibabaToken !== null
    && (alibabaToken.expires_at <= 0 || alibabaToken.expires_at >= Date.now())

  return [
    { id: "github-copilot", label: "GitHub Copilot", authenticated: ghAuth },
    {
      id: "antigravity",
      label: "Antigravity (Google Code Assist)",
      authenticated: antigravityAuth,
    },
    {
      id: "alibaba",
      label: "Alibaba (DashScope / Qwen)",
      authenticated: alibabaAuth,
    },
  ]
}

function printStatuses(statuses: Array<ProviderStatus>): void {
  consola.log("")
  for (const s of statuses) {
    const dot = s.authenticated ? "\x1b[32m●\x1b[0m" : "\x1b[31m●\x1b[0m"
    consola.log(`  ${dot}  ${s.label}`)
  }
  consola.log("")
}

// ─── Provider setup ──────────────────────────────────────────────────────────

async function selectAndSetupProvider(
  statuses: Array<ProviderStatus>,
): Promise<Provider> {
  const authenticatedProviders = statuses.filter((s) => s.authenticated)
  if (authenticatedProviders.length === 0) {
    consola.error("No authenticated providers. Run: omnimodel auth")
    process.exit(1)
  }

  const selectedProviderId = await consola.prompt("Select a provider", {
    type: "select",
    options: authenticatedProviders.map((p) => ({
      label: p.label,
      value: p.id,
    })),
  })

  const provider = providerRegistry.getProvider(selectedProviderId)
  consola.info(`Using: ${provider.name}`)

  try {
    await provider.setupAuth()
  } catch (error) {
    consola.error(
      `Failed to load auth: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }

  return provider
}

// ─── Model selection ─────────────────────────────────────────────────────────

async function selectModel(provider: Provider): Promise<string> {
  let models
  try {
    const modelsResponse = await provider.getModels()
    models = modelsResponse.data
    if (models.length === 0) {
      consola.error("No models available for this provider")
      process.exit(1)
    }
  } catch (error) {
    consola.error(
      `Failed to get models: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }

  return await selectModelWithFilter(
    models.map((m) => ({ id: m.id, name: m.name })),
    "Select a model",
  )
}

// ─── Message formatters ──────────────────────────────────────────────────────

function displayErrorWithHint(error: unknown): void {
  const errorMsg = error instanceof Error ? error.message : String(error)
  consola.error(`Error: ${errorMsg}`)

  // Provide context-aware recovery hints
  if (errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
    consola.info("💡 Hint: Run 'omnimodel auth' to refresh authentication")
  } else if (
    errorMsg.includes("rate")
    || errorMsg.includes("429")
    || errorMsg.includes("Too Many Requests")
  ) {
    consola.info("💡 Hint: Wait a moment and try again (rate limited)")
  } else if (
    errorMsg.includes("ECONNREFUSED")
    || errorMsg.includes("Connection refused")
  ) {
    consola.info(
      "💡 Hint: Ensure the provider service is running or check your network",
    )
  } else if (errorMsg.includes("No authenticated providers")) {
    consola.info("💡 Hint: Run 'omnimodel auth' to authenticate a provider")
  }
}

// ─── Command handlers ────────────────────────────────────────────────────────

interface CommandContext {
  messages: Array<Message>
  provider: Provider
  modelId: string
  lastResponse: string
}

type CommandHandler = (
  context: CommandContext,
) => Promise<"continue" | "break" | "send">

const chatCommands = new Map<
  string,
  { handler: CommandHandler; description: string }
>([
  [
    "quit",
    {
      description: "Exit the chat",
      handler: () => {
        consola.log("Goodbye!")
        return Promise.resolve("break" as const)
      },
    },
  ],
  [
    "exit",
    {
      description: "Exit the chat",
      handler: () => {
        consola.log("Goodbye!")
        return Promise.resolve("break" as const)
      },
    },
  ],
  [
    "clear",
    {
      description: "Clear conversation history",
      handler: (ctx) => {
        ctx.messages.length = 0
        consola.info("Conversation cleared")
        return Promise.resolve("continue" as const)
      },
    },
  ],
  [
    "status",
    {
      description: "Show chat status and statistics",
      handler: (ctx) => {
        consola.info("")
        consola.info(`Provider: ${ctx.provider.name}`)
        consola.info(`Model: ${ctx.modelId}`)
        consola.info(`Messages: ${ctx.messages.length}`)
        consola.info("")
        return Promise.resolve("continue" as const)
      },
    },
  ],
  [
    "copy",
    {
      description: "Copy last response to clipboard",
      handler: async (ctx) => {
        if (!ctx.lastResponse) {
          consola.warn("No response to copy yet")
          return "continue"
        }
        try {
          const clipboard = await import("clipboardy")
          await clipboard.default.write(ctx.lastResponse)
          consola.success("Last response copied to clipboard")
        } catch {
          consola.warn("Failed to copy to clipboard")
        }
        return "continue"
      },
    },
  ],
  [
    "help",
    {
      description: "Show available commands",
      handler: () => {
        consola.info("")
        consola.info("\x1b[1mAvailable Commands:\x1b[0m")
        for (const [cmd, info] of chatCommands.entries()) {
          consola.info(`  \x1b[36m/${cmd}\x1b[0m - ${info.description}`)
        }
        consola.info("")
        return Promise.resolve("continue" as const)
      },
    },
  ],
])

function handleSlashCommand(
  command: string,
  context: CommandContext,
): Promise<"continue" | "break" | "send"> {
  const cmd = command.slice(1).split(" ")[0] // Remove leading / and get first word
  const handler = chatCommands.get(cmd)

  if (!handler) {
    consola.warn(`Unknown command: /${cmd}. Type /help for available commands.`)
    return Promise.resolve("continue")
  }

  return handler.handler(context)
}

// ─── Stream handler ──────────────────────────────────────────────────────────

// Stream handling is now integrated into the chat loop for better layout control

function streamToSSE(stream: AsyncGenerator): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      } finally {
        controller.close()
      }
    },
  })
}

async function createChatResponse(
  provider: Provider,
  selectedModelId: string,
  messages: Array<Message>,
): Promise<Response> {
  const canonicalRequest = parseOpenAIChatCompletions({
    model: selectedModelId,
    messages,
    stream: true,
  })
  const remappedModel =
    provider.adapter?.remapModel?.(canonicalRequest.model)
    ?? canonicalRequest.model
  const finalCanonicalRequest = {
    ...canonicalRequest,
    model: remappedModel,
  }

  if (provider.adapter) {
    return new Response(
      streamToSSE(provider.adapter.executeStream(finalCanonicalRequest)),
      { headers: { "content-type": "text/event-stream" } },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return await provider.createChatCompletions(
    canonicalRequestToChatCompletionsPayload(
      finalCanonicalRequest,
    ) as unknown as Record<string, unknown>,
  )
}

async function sendMessage(
  provider: Provider,
  selectedModelId: string,
  messages: Array<Message>,
): Promise<string> {
  // Quiet mode: only show errors during streaming
  consola.level = 1

  const response = await createChatResponse(provider, selectedModelId, messages)

  // Stream content token-by-token to stdout with "* " prefix
  let assistantContent = ""
  for await (const event of events(response)) {
    if (typeof event !== "object") continue
    const eventObj = event as Record<string, unknown>
    const data = eventObj.data
    if (!data || data === "[DONE]") continue
    try {
      const dataStr = typeof data === "string" ? data : JSON.stringify(data)
      const chunk = JSON.parse(dataStr) as {
        choices?: Array<{ delta?: { content?: string } }>
      }
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) {
        if (assistantContent === "") process.stdout.write("* ")
        process.stdout.write(delta)
        assistantContent += delta
      }
    } catch {
      // Skip unparseable chunks
    }
  }

  if (assistantContent) process.stdout.write("\n")

  consola.level = 3

  return assistantContent
}

// ─── Chat command ────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant"
  content: string
}

export const chat = defineCommand({
  meta: {
    name: "chat",
    description: "Interactive chat shell for testing providers",
  },
  async run() {
    await ensurePaths()

    // Load existing providers from database instead of creating placeholders
    const { loadConfig } = await import("~/lib/config-db")
    await loadConfig()

    // Show status and select provider
    const statuses = await getProviderStatuses()
    printStatuses(statuses)

    const provider = await selectAndSetupProvider(statuses)
    const selectedModelId = await selectModel(provider)

    consola.info(`Model: ${selectedModelId}`)
    consola.info("")

    const messages: Array<Message> = []
    let lastResponse = ""

    while (true) {
      const userInput = await readLine()

      const trimmed = userInput.trim()

      if (trimmed === "") continue

      // Handle slash commands
      if (trimmed.startsWith("/")) {
        const commandContext: CommandContext = {
          messages,
          provider,
          modelId: selectedModelId,
          lastResponse,
        }
        const action = await handleSlashCommand(trimmed, commandContext)
        if (action === "break") break
        if (action === "continue") continue
      }

      messages.push({ role: "user", content: trimmed })

      try {
        // Response streams directly to stdout via sendMessage
        const assistantContent = await sendMessage(
          provider,
          selectedModelId,
          messages,
        )

        lastResponse = assistantContent
        messages.push({ role: "assistant", content: assistantContent })
      } catch (error) {
        displayErrorWithHint(error)
      }
    }

    process.exit(0)
  },
})
