import consola from "consola"

import type { Provider } from "~/providers/types"
import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"
import type { ModelsResponse } from "~/services/copilot/get-models"

import { state } from "~/lib/state"
import { providerRegistry } from "~/providers/registry"
import { createChatCompletions as copilotCreateChatCompletions } from "~/services/copilot/create-chat-completions"
import { createEmbeddings as copilotCreateEmbeddings } from "~/services/copilot/create-embeddings"
import { getModels as copilotGetModels } from "~/services/copilot/get-models"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

import { GitHubCopilotAdapter } from "./adapter"
import { getCopilotBaseUrl, getCopilotHeaders } from "./api"
import {
  setupGitHubCopilotAuth,
  setupCopilotTokenRefresh,
  readGitHubLogin,
} from "./auth"

export class GitHubCopilotProvider implements Provider {
  id = "github-copilot" as const
  instanceId: string
  name: string

  // CIF Adapter
  readonly adapter = new GitHubCopilotAdapter(this)

  constructor(instanceId: string) {
    this.instanceId = instanceId
    this.name = "GitHub Copilot"
  }

  async setupAuth(options?: {
    force?: boolean
    githubToken?: string
  }): Promise<void> {
    if (options?.githubToken) {
      state.githubToken = options.githubToken
      consola.info("Using provided GitHub token")
      try {
        const { getGitHubUser } = await import("~/services/github/get-user")
        const user = await getGitHubUser()
        // Store in per-instance format
        const { writeGithubToken } = await import("./auth")
        await writeGithubToken(options.githubToken, user.login, this.instanceId)
      } catch {
        // Non-fatal — name stays generic if this fails
      }
    } else {
      const authResult = await setupGitHubCopilotAuth(this.instanceId, options)

      // If OAuth returned a final instance ID, we need to create a new provider
      if (
        authResult?.finalInstanceId
        && authResult.finalInstanceId !== this.instanceId
      ) {
        // Create new provider with the correct final name
        const newProvider = new GitHubCopilotProvider(
          authResult.finalInstanceId,
        )

        // Update the name with the username from the token
        const login = await readGitHubLogin(authResult.finalInstanceId)
        if (login) {
          newProvider.name = `GitHub Copilot (${login})`
        }

        // Register the new provider
        await providerRegistry.register(newProvider)

        // Remove the old generic provider instance
        await providerRegistry.remove(this.instanceId)

        consola.info(
          `Created new GitHub Copilot instance: ${authResult.finalInstanceId}`,
        )
        return // Exit early since this instance will be removed
      }

      // Read the token from the per-instance store to set state
      const { readGithubToken } = await import("./auth")
      const token = await readGithubToken(this.instanceId)
      if (token) {
        state.githubToken = token
      }
    }

    // Initialize Copilot API token
    try {
      await setupCopilotTokenRefresh()
    } catch (error) {
      consola.warn(
        `Failed to initialize Copilot token for ${this.instanceId}:`,
        error,
      )
      // Don't throw - let the provider be registered but mark it as having auth issues
    }
  }

  getToken(): string {
    if (!state.copilotToken) throw new Error("Copilot token not found")
    return state.copilotToken
  }

  async getGitHubToken(): Promise<string> {
    // Read GitHub token from per-instance storage
    const { readGithubToken } = await import("./auth")
    const token = await readGithubToken(this.instanceId)

    consola.debug(
      `Reading GitHub token for ${this.instanceId}: ${token ? `${token.slice(0, 10)}...` : "NO TOKEN"}`,
    )

    return token
  }

  async refreshToken(): Promise<void> {
    // Token is automatically refreshed in setupCopilotTokenRefresh
  }

  getBaseUrl(): string {
    return getCopilotBaseUrl(state)
  }

  getHeaders(forVision?: boolean): Record<string, string> {
    return getCopilotHeaders(state, forVision)
  }

  async getModels(): Promise<ModelsResponse> {
    // Get GitHub token for this instance and use it to obtain Copilot token
    const githubToken = await this.getGitHubToken()

    if (!githubToken) {
      throw new Error(`No GitHub token found for instance ${this.instanceId}`)
    }

    consola.debug(
      `Getting models for ${this.instanceId} using GitHub token: ${githubToken.slice(0, 10)}...`,
    )

    return copilotGetModels(githubToken)
  }

  async createChatCompletions(
    payload: Record<string, unknown>,
  ): Promise<Response> {
    const model = (payload.model as string | undefined) ?? "unknown"
    const stream = Boolean(payload.stream)
    const copilotPayload = payload as unknown as ChatCompletionsPayload

    consola.info(
      `📤 ${this.name} (${this.instanceId}): ${model} | ${getCopilotBaseUrl(state)}/chat/completions | Stream: ${stream}`,
    )

    // Get GitHub token for this instance
    const githubToken = await this.getGitHubToken()

    if (!githubToken) {
      throw new Error(`No GitHub token found for instance ${this.instanceId}`)
    }

    const result = await copilotCreateChatCompletions(
      copilotPayload,
      {
        name: this.name,
        instanceId: this.instanceId,
      },
      githubToken,
    )

    // Convert result to Response format for consistency
    if (result instanceof Response || result instanceof ReadableStream) {
      return result as Response
    }

    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    })
  }

  async createEmbeddings(payload: Record<string, unknown>): Promise<Response> {
    const result = await copilotCreateEmbeddings(payload as never)
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    })
  }

  async getUsage(): Promise<Response> {
    const githubToken = await this.getGitHubToken()
    const usage = await getCopilotUsage(githubToken)
    return new Response(JSON.stringify(usage), {
      headers: { "content-type": "application/json" },
    })
  }
}
