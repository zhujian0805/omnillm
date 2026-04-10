import consola from "consola"

import { state } from "~/lib/state"

import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_CALLBACK_PORT,
  ANTIGRAVITY_SCOPES,
  ANTIGRAVITY_TOKEN_ENDPOINT,
  ANTIGRAVITY_AUTH_ENDPOINT,
  ANTIGRAVITY_USERINFO_ENDPOINT,
  ANTIGRAVITY_API_ENDPOINT,
  ANTIGRAVITY_API_VERSION,
  ANTIGRAVITY_USER_AGENT,
  ANTIGRAVITY_API_CLIENT,
  ANTIGRAVITY_CLIENT_METADATA,
  ANTIGRAVITY_REFRESH_SKEW_SECONDS,
} from "./constants"

export interface AntigravityTokenData {
  access_token: string
  refresh_token: string
  expires_at: number // unix timestamp (ms)
  email?: string
  project_id?: string
  client_id?: string
  client_secret?: string
}

export const readAntigravityToken = async (
  instanceId: string,
): Promise<AntigravityTokenData | null> => {
  const { readAntigravityToken: dbReadToken } = await import("~/lib/token-db")
  return await dbReadToken(instanceId)
}

export const writeAntigravityToken = async (
  data: AntigravityTokenData,
  instanceId: string,
): Promise<void> => {
  const { writeAntigravityToken: dbWriteToken } = await import("~/lib/token-db")
  await dbWriteToken(data, instanceId)
}

function buildAuthURL(stateParam: string, clientId: string): string {
  const redirectURI = `http://localhost:${ANTIGRAVITY_CALLBACK_PORT}/oauth-callback`
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: clientId,
    prompt: "select_account consent",
    redirect_uri: redirectURI,
    response_type: "code",
    scope: ANTIGRAVITY_SCOPES.join(" "),
    state: stateParam,
  })
  return `${ANTIGRAVITY_AUTH_ENDPOINT}?${params.toString()}`
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const redirectURI = `http://localhost:${ANTIGRAVITY_CALLBACK_PORT}/oauth-callback`
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectURI,
    grant_type: "authorization_code",
  })

  const response = await fetch(ANTIGRAVITY_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed (${response.status}): ${text}`)
  }

  return response.json() as Promise<{
    access_token: string
    refresh_token: string
    expires_in: number
  }>
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(ANTIGRAVITY_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok)
    throw new Error(`UserInfo request failed: ${response.status}`)
  const data = (await response.json()) as { email?: string }
  return data.email ?? ""
}

export async function fetchProjectID(accessToken: string): Promise<string> {
  const endpointURL = `${ANTIGRAVITY_API_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`
  const body = {
    metadata: {
      ideType: "ANTIGRAVITY",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
  }

  const response = await fetch(endpointURL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_USER_AGENT,
      "X-Goog-Api-Client": ANTIGRAVITY_API_CLIENT,
      "Client-Metadata": ANTIGRAVITY_CLIENT_METADATA,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    consola.warn(`loadCodeAssist failed (${response.status}): ${text}`)
    return ""
  }

  const data = (await response.json()) as Record<string, unknown>

  const projectID = data["cloudaicompanionProject"]
  if (typeof projectID === "string" && projectID) return projectID
  if (typeof projectID === "object" && projectID !== null) {
    const id = (projectID as Record<string, unknown>)["id"]
    if (typeof id === "string" && id) return id
  }

  return ""
}

function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const pending = { data: "" }
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: ANTIGRAVITY_CALLBACK_PORT,
      socket: {
        data(_socket, chunk) {
          pending.data += Buffer.from(chunk).toString()
          const requestLine = pending.data.split("\r\n")[0] ?? ""
          const match = /GET \/oauth-callback\?(.+) HTTP/.exec(requestLine)
          if (!match) return

          const params = new URLSearchParams(match[1])
          const code = params.get("code")
          const html =
            "<html><body><h2>Authentication successful! You can close this tab.</h2></body></html>"
          _socket.write(
            `HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${html.length}\r\nConnection: close\r\n\r\n${html}`,
          )
          _socket.end()
          server.stop()
          if (code) resolve(code)
          else reject(new Error("No code in OAuth callback"))
        },
        error(_socket, error) {
          consola.debug("OAuth callback socket error:", error)
        },
      },
    })

    consola.debug(
      `OAuth callback server listening on port ${ANTIGRAVITY_CALLBACK_PORT}`,
    )

    setTimeout(
      () => {
        server.stop()
        reject(new Error("OAuth flow timed out after 5 minutes"))
      },
      5 * 60 * 1000,
    )
  })
}

export async function setupAntigravityAuth(
  instanceId: string,
  options?: {
    force?: boolean
    clientId?: string
    clientSecret?: string
  },
): Promise<void> {
  const existing = await readAntigravityToken(instanceId)
  if (existing && !options?.force) {
    consola.info(
      `Antigravity: already logged in${existing.email ? ` as ${existing.email}` : ""} (instance: ${instanceId})`,
    )
    return
  }

  const clientId = options?.clientId || ANTIGRAVITY_CLIENT_ID
  const clientSecret = options?.clientSecret || ANTIGRAVITY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error(
      "Antigravity OAuth requires ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET to be set",
    )
  }

  const stateParam = crypto.randomUUID()
  const authURL = buildAuthURL(stateParam, clientId)

  if (state.authFlow) {
    state.authFlow.status = "awaiting_user"
    state.authFlow.instructionURL = authURL
  }

  consola.info("Opening browser for Antigravity (Google) OAuth login...")
  consola.info(`If the browser doesn't open, visit: ${authURL}`)

  // Try to open the browser
  try {
    const platform = process.platform
    if (platform === "win32") {
      // Use PowerShell to avoid & being interpreted as shell command separator
      await Bun.$`powershell -Command "Start-Process '${authURL}'"`.quiet()
    } else if (platform === "darwin") {
      await Bun.$`open ${authURL}`.quiet()
    } else {
      await Bun.$`xdg-open ${authURL}`.quiet()
    }
  } catch {
    consola.warn(
      "Could not open browser automatically. Please open the URL above manually.",
    )
  }

  consola.info("Waiting for OAuth callback...")
  const code = await waitForCallback()

  consola.debug("Exchanging authorization code for tokens...")
  const tokens = await exchangeCodeForTokens(code, clientId, clientSecret)

  const expiresAt = Date.now() + tokens.expires_in * 1000
  const email = await fetchUserEmail(tokens.access_token).catch(() => "")
  const projectId = await fetchProjectID(tokens.access_token).catch(() => "")

  const tokenData: AntigravityTokenData = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    email,
    project_id: projectId,
    client_id: clientId,
    client_secret: clientSecret,
  }

  await writeAntigravityToken(tokenData, instanceId)
  consola.success(
    `Antigravity authentication successful${email ? ` (${email})` : ""} for instance ${instanceId}`,
  )
}

export async function refreshAntigravityToken(
  data: AntigravityTokenData,
  instanceId: string,
): Promise<AntigravityTokenData> {
  const body = new URLSearchParams({
    refresh_token: data.refresh_token,
    client_id: data.client_id || ANTIGRAVITY_CLIENT_ID,
    client_secret: data.client_secret || ANTIGRAVITY_CLIENT_SECRET,
    grant_type: "refresh_token",
  })

  const response = await fetch(ANTIGRAVITY_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed (${response.status}): ${text}`)
  }

  const refreshed = (await response.json()) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }

  const updated: AntigravityTokenData = {
    ...data,
    access_token: refreshed.access_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
    // Google may or may not return a new refresh token
    refresh_token: refreshed.refresh_token ?? data.refresh_token,
  }

  await writeAntigravityToken(updated, instanceId)
  return updated
}

export function isTokenExpiringSoon(data: AntigravityTokenData): boolean {
  return data.expires_at - Date.now() < ANTIGRAVITY_REFRESH_SKEW_SECONDS * 1000
}
