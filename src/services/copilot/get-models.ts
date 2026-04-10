import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const getModels = async (githubToken?: string) => {
  // In multi-provider setup, we need the GitHub token to get the Copilot token
  const token = githubToken || state.githubToken

  if (!token) {
    throw new Error("GitHub token is required for models API")
  }

  // Get Copilot token using the GitHub token
  const { getCopilotToken } = await import(
    "~/services/github/get-copilot-token"
  )

  // Create temporary state with the GitHub token for this request
  const originalGithubToken = state.githubToken
  state.githubToken = token

  try {
    const copilotTokenResponse = await getCopilotToken()
    const copilotToken = copilotTokenResponse.token

    // Create headers using the obtained Copilot token
    const originalCopilotToken = state.copilotToken
    state.copilotToken = copilotToken

    const headers = copilotHeaders(state)
    const url = `${copilotBaseUrl(state)}/models`

    consola.debug(`Fetching models from: ${url}`)
    consola.debug(`Using Copilot token: ${copilotToken.slice(0, 10)}...`)

    const response = await fetch(url, { headers })

    // Restore original state
    state.copilotToken = originalCopilotToken

    if (!response.ok) {
      const errorBody = await response
        .text()
        .catch(() => "Unable to read error body")
      consola.error(
        `Models API failed: ${response.status} ${response.statusText}`,
      )
      consola.error(`Error body: ${errorBody}`)
      consola.error(`Request headers:`, headers)
      throw new HTTPError("Failed to get models", response)
    }

    const result = await response.json()
    consola.debug(`Successfully fetched ${result.data?.length || 0} models`)
    return result as ModelsResponse
  } finally {
    // Always restore original GitHub token
    state.githubToken = originalGithubToken
  }
}

export interface ModelsResponse {
  data: Array<Model>
  object: string
}

interface ModelLimits {
  max_context_window_tokens?: number
  max_output_tokens?: number
  max_prompt_tokens?: number
  max_inputs?: number
}

interface ModelSupports {
  tool_calls?: boolean
  parallel_tool_calls?: boolean
  dimensions?: boolean
}

interface ModelCapabilities {
  family: string
  limits: ModelLimits
  object: string
  supports: ModelSupports
  tokenizer: string
  type: string
}

export interface Model {
  capabilities: ModelCapabilities
  id: string
  model_picker_enabled: boolean
  name: string
  object: string
  preview: boolean
  vendor: string
  version: string
  policy?: {
    state: string
    terms: string
  }
}
