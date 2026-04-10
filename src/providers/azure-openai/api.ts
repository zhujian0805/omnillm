import type { AzureOpenAITokenData } from "./auth"

export function getAzureOpenAIBaseUrl(tokenData: AzureOpenAITokenData): string {
  return tokenData.endpoint
}

export function getAzureOpenAIHeaders(
  tokenData: AzureOpenAITokenData,
  stream: boolean,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "api-key": tokenData.api_key,
    Accept: stream ? "text/event-stream" : "application/json",
  }
}

/**
 * Build the Azure OpenAI chat completions URL.
 * Azure uses a different URL scheme than OpenAI:
 *   {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}
 *
 * When the model name contains a slash (e.g. "azure/gpt-4o"), we strip the prefix.
 * For GPT-5.3+ models, add beta=true parameter if needed.
 */
export function buildAzureChatUrl(
  tokenData: AzureOpenAITokenData,
  model: string,
): string {
  const deployment = model.startsWith("azure/") ? model.slice(6) : model
  let apiVersion = tokenData.api_version

  // GPT-5.3-codex may need a specific API version
  if (model.includes("gpt-5.3-codex")) {
    // Try the latest preview version for codex models
    apiVersion = "2024-12-01-preview"
  }

  let url = `${tokenData.endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`

  // Add beta parameter for specific models that require it
  // Exclude codex models from beta parameter as they may not support it
  const needsBeta =
    (model.includes("gpt-5.4") && !model.includes("codex"))
    || model.includes("gpt-6")

  if (needsBeta) {
    url += "&beta=true"
  }

  return url
}

/**
 * Build the Azure OpenAI completions URL for Codex models.
 * Codex models use the /completions endpoint instead of /chat/completions
 */
export function buildAzureCompletionsUrl(
  tokenData: AzureOpenAITokenData,
  model: string,
): string {
  const deployment = model.startsWith("azure/") ? model.slice(6) : model
  let url = `${tokenData.endpoint}/openai/deployments/${deployment}/completions?api-version=${tokenData.api_version}`

  // Add beta parameter for Codex models
  if (model.includes("codex")) {
    url += "&beta=true"
  }

  return url
}

/**
 * Check if a model needs the Azure Responses API instead of Chat Completions.
 * All GPT-5.x models use the Responses API — gpt-5.4-pro, gpt-5.3-codex, and
 * gpt-5.1-codex-max ONLY work with the Responses API (chat completions return 400).
 */
export function isResponsesApiModel(model: string): boolean {
  const modelLower = model.toLowerCase()

  // All GPT-5.x models use the responses API
  const responsesApiPatterns = [
    "gpt-5.1-codex",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5-codex",
    "gpt-5.4",
  ]

  return responsesApiPatterns.some((pattern) => modelLower.includes(pattern))
}

/**
 * Build the Azure OpenAI responses URL for models that need the responses API
 * Responses API is available on the traditional Azure OpenAI endpoint
 */
export function buildAzureResponsesUrl(
  tokenData: AzureOpenAITokenData,
  _model: string,
): string {
  // Use the OpenAI v1 API format that the SDK uses
  // The responses API is available at: {endpoint}/openai/v1/responses
  const url = `${tokenData.endpoint}/openai/v1/responses`

  return url
}

/**
 * Check if a model is a Codex model that needs the completions endpoint
 * Note: Not all models with "codex" in the name are traditional Codex models
 * GPT-5.3-codex and similar are actually chat models optimized for code
 */
export function isCodexModel(model: string): boolean {
  const modelLower = model.toLowerCase()

  // Traditional Codex models that use /completions endpoint
  // These are typically older Codex models like code-davinci, code-cushman
  const traditionalCodexPatterns = [
    "code-davinci",
    "code-cushman",
    "codex-davinci",
    "codex-cushman",
  ]

  // Check if it matches traditional Codex patterns
  return traditionalCodexPatterns.some((pattern) =>
    modelLower.includes(pattern),
  )

  // GPT-5.x-codex models are NOT traditional Codex - they're chat models
  // So we return false for gpt-5.3-codex, gpt-5.1-codex-max, etc.
}

export function buildAzureEmbeddingsUrl(
  tokenData: AzureOpenAITokenData,
  model: string,
): string {
  const deployment = model.startsWith("azure/") ? model.slice(6) : model
  return `${tokenData.endpoint}/openai/deployments/${deployment}/embeddings?api-version=${tokenData.api_version}`
}

export function buildAzureModelsUrl(tokenData: AzureOpenAITokenData): string {
  // Azure OpenAI doesn't have a direct endpoint to list deployments in the OpenAI-compatible API
  // We'll return a mock endpoint and handle this in the handler
  return `${tokenData.endpoint}/openai/models?api-version=${tokenData.api_version}`
}
