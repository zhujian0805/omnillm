import consola from "consola"

import { HTTPError } from "~/lib/error"
import { PATHS } from "~/lib/paths"
import { state } from "~/lib/state"
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessToken } from "~/services/github/poll-access-token"

export interface GitHubTokenData {
  token: string
  login: string
}

export const readGithubToken = async (instanceId?: string): Promise<string> => {
  if (!instanceId) return ""

  // Use database storage
  const { readGithubToken: dbReadGithubToken } = await import("~/lib/token-db")
  return await dbReadGithubToken(instanceId)
}

const writeGithubToken = async (
  token: string,
  login: string,
  instanceId?: string,
) => {
  if (!instanceId) {
    throw new Error("instanceId is required for writing GitHub tokens")
  }

  // Use database storage
  const { writeGithubToken: dbWriteGithubToken } = await import(
    "~/lib/token-db"
  )
  await dbWriteGithubToken(token, login, instanceId)
}

export { writeGithubToken }

/**
 * Migrates legacy GitHub tokens from root directory to database
 * This runs automatically when setting up auth for any GitHub Copilot instance
 */
async function migrateLegacyTokens(instanceId: string): Promise<void> {
  try {
    // Check if we already have a token in the database
    const existingToken = await readGithubToken(instanceId)
    if (existingToken) {
      return // Already migrated
    }

    // Check for legacy files
    const legacyTokenFile = Bun.file(PATHS.GITHUB_TOKEN_PATH)
    const legacyUserFile = Bun.file(PATHS.GITHUB_USER_PATH)

    if (!(await legacyTokenFile.exists())) {
      return // No legacy token to migrate
    }

    const token = (await legacyTokenFile.text()).trim()
    if (!token) {
      consola.debug("Legacy token file is empty, no migration needed")
      return
    }

    let login = ""
    if (await legacyUserFile.exists()) {
      login = (await legacyUserFile.text()).trim()
    }

    // If no login found in legacy file, try to fetch it from GitHub
    if (!login && token) {
      try {
        // Set the token temporarily to fetch user info
        const currentToken = state.githubToken
        state.githubToken = token
        try {
          const user = await getGitHubUser()
          login = user.login
        } finally {
          // Always restore the previous token state
          state.githubToken = currentToken
        }
      } catch {
        // If we can't get user info, use a default instance name
        login = "user"
      }
    }

    // Migrate to database storage
    await writeGithubToken(token, login, instanceId)
    consola.info(
      `Migrated GitHub token to database for instance: ${instanceId}`,
    )
  } catch (error) {
    consola.warn("Failed to migrate legacy GitHub tokens:", error)
  }
}

export const readGitHubLogin = async (
  instanceId?: string,
): Promise<string | null> => {
  if (!instanceId) return null

  // Use database storage
  const { readGitHubLogin: dbReadGitHubLogin } = await import("~/lib/token-db")
  return await dbReadGitHubLogin(instanceId)
}

export async function setupGitHubCopilotAuth(
  instanceId: string,
  options?: {
    force?: boolean
  },
): Promise<{ finalInstanceId?: string } | void> {
  try {
    // First, migrate any legacy tokens to the providers folder
    await migrateLegacyTokens(instanceId)

    const githubToken = await readGithubToken(instanceId)

    if (githubToken && !options?.force) {
      state.githubToken = githubToken
      if (state.showToken) {
        consola.info("GitHub token:", githubToken)
      }
      await logUser(instanceId)
      return // No finalInstanceId returned for existing tokens
    }

    consola.info("Not logged in, getting new access token")
    const response = await getDeviceCode()
    consola.debug("Device code response:", response)

    consola.info(
      `Please enter the code "${response.user_code}" in ${response.verification_uri}`,
    )

    if (state.authFlow) {
      state.authFlow.status = "awaiting_user"
      state.authFlow.instructionURL = response.verification_uri
      state.authFlow.userCode = response.user_code
    }

    // Auto-open browser so user can paste the code without copy-pasting the URL
    try {
      if (process.platform === "win32") {
        await Bun.$`powershell -Command "Start-Process '${response.verification_uri}'"`.quiet()
      } else if (process.platform === "darwin") {
        await Bun.$`open ${response.verification_uri}`.quiet()
      } else {
        await Bun.$`xdg-open ${response.verification_uri}`.quiet()
      }
    } catch {
      consola.warn(
        "Could not open browser automatically. Please visit the URL above.",
      )
    }

    const token = await pollAccessToken(response)

    // Fetch user info to determine the final instance ID
    const user = await getGitHubUser(token)

    // Calculate the final instance ID
    const finalInstanceId = `github-copilot-${user.login.toLowerCase()}`

    // Write token directly to the final location
    await writeGithubToken(token, user.login, finalInstanceId)

    // Set the token in state for immediate use
    state.githubToken = token

    if (state.showToken) {
      consola.info("GitHub token:", token)
    }

    // Log user info
    consola.info(`Logged in as ${user.login}`)

    // Return the final instanceId so the provider can be created with the correct name
    return { token, login: user.login, finalInstanceId }
  } catch (error) {
    if (error instanceof HTTPError) {
      consola.error("Failed to get GitHub token:", await error.response.json())
      throw error
    }

    consola.error("Failed to get GitHub token:", error)
    throw error
  }
}

export async function setupCopilotTokenRefresh(): Promise<void> {
  const { token, refresh_in } = await getCopilotToken()
  state.copilotToken = token

  consola.debug("GitHub Copilot Token fetched successfully!")
  if (state.showToken) {
    consola.info("Copilot token:", token)
  }

  const refreshInterval = (refresh_in - 60) * 1000
  setInterval(async () => {
    consola.debug("Refreshing Copilot token")
    try {
      const { token } = await getCopilotToken()
      state.copilotToken = token
      consola.debug("Copilot token refreshed")
      if (state.showToken) {
        consola.info("Refreshed Copilot token:", token)
      }
    } catch (error) {
      consola.error("Failed to refresh Copilot token:", error)
      throw error
    }
  }, refreshInterval)
}

async function logUser(_instanceId: string) {
  const user = await getGitHubUser()
  consola.info(`Logged in as ${user.login}`)
}
