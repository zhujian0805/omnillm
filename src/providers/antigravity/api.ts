import {
  ANTIGRAVITY_API_ENDPOINT,
  ANTIGRAVITY_API_VERSION,
  ANTIGRAVITY_USER_AGENT,
  ANTIGRAVITY_API_CLIENT,
  ANTIGRAVITY_CLIENT_METADATA,
} from "./constants"

export function getAntigravityBaseUrl(): string {
  return ANTIGRAVITY_API_ENDPOINT
}

export function getAntigravityHeaders(
  accessToken: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_USER_AGENT,
    "X-Goog-Api-Client": ANTIGRAVITY_API_CLIENT,
    "Client-Metadata": ANTIGRAVITY_CLIENT_METADATA,
  }
}

export function getAntigravityStreamPath(): string {
  return `/${ANTIGRAVITY_API_VERSION}:streamGenerateContent`
}

export function getAntigravityGeneratePath(): string {
  return `/${ANTIGRAVITY_API_VERSION}:generateContent`
}

export function getAntigravityModelsPath(): string {
  return `/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`
}
