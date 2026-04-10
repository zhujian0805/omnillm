import type { AlibabaTokenData } from "./auth"

import { ALIBABA_DEFAULT_BASE_URL, ALIBABA_USER_AGENT } from "./constants"

export function getAlibabaBaseUrl(tokenData: AlibabaTokenData): string {
  // API key auth: use the explicit base_url chosen at setup time
  if (tokenData.auth_type === "api-key") {
    return tokenData.base_url || ALIBABA_DEFAULT_BASE_URL
  }

  // OAuth auth: use resource_url from token response if provided (enterprise instances)
  const resourceUrl = tokenData.resource_url
  if (!resourceUrl) {
    return ALIBABA_DEFAULT_BASE_URL
  }

  let url =
    resourceUrl.startsWith("http") ? resourceUrl : `https://${resourceUrl}`
  if (!url.endsWith("/v1")) {
    url = `${url}/v1`
  }
  return url
}

export function getAlibabaHeaders(
  tokenData: AlibabaTokenData,
  stream: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokenData.access_token}`,
    Accept: stream ? "text/event-stream" : "application/json",
  }

  // OAuth-specific headers
  if (tokenData.auth_type === "oauth") {
    headers["User-Agent"] = ALIBABA_USER_AGENT
    headers["X-DashScope-UserAgent"] = ALIBABA_USER_AGENT
    headers["X-DashScope-AuthType"] = "qwen-oauth"
    headers["X-DashScope-CacheControl"] = "enable"
    headers["X-Stainless-Runtime"] = "node"
    headers["X-Stainless-Runtime-Version"] = "v22.17.0"
    headers["X-Stainless-Lang"] = "js"
    headers["X-Stainless-Arch"] = "arm64"
    headers["X-Stainless-Os"] = "MacOS"
    headers["X-Stainless-Package-Version"] = "5.11.0"
    headers["X-Stainless-Retry-Count"] = "0"
  }

  return headers
}
