export interface AzureOpenAITokenData {
  auth_type: "api-key"
  api_key: string
  endpoint: string // e.g. https://my-resource.openai.azure.com
  api_version: string // e.g. 2024-02-01
  resource_name: string // derived from endpoint for display
  deployments: Array<string> // deployment names specified by user
}

export const readAzureOpenAIToken = async (
  instanceId: string,
): Promise<AzureOpenAITokenData | null> => {
  const { readAzureOpenAIToken: dbReadToken } = await import("~/lib/token-db")
  return await dbReadToken(instanceId)
}

export const writeAzureOpenAIToken = async (
  data: AzureOpenAITokenData,
  instanceId: string,
): Promise<void> => {
  const { writeAzureOpenAIToken: dbWriteToken } = await import("~/lib/token-db")
  await dbWriteToken(data, instanceId)
}

/** Derive a short resource name from the endpoint URL for display/instance naming */
export function resourceNameFromEndpoint(endpoint: string): string {
  try {
    const url = new URL(
      endpoint.startsWith("http") ? endpoint : `https://${endpoint}`,
    )
    // e.g. my-resource.openai.azure.com -> my-resource
    return url.hostname.split(".")[0]
  } catch {
    return endpoint.replace(/https?:\/\//, "").split(".")[0]
  }
}

/** Normalize endpoint: ensure no trailing slash, ensure https:// prefix, strip common path suffixes */
export function normalizeEndpoint(endpoint: string): string {
  let url = endpoint.trim().replace(/\/+$/, "")
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`
  }

  // Strip common Azure OpenAI path suffixes that users might include
  url = url
    .replace(/\/openai\/v1$/, "")
    .replace(/\/openai$/, "")
    .replace(/\/v1$/, "")

  return url
}
