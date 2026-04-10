import type { ProviderID } from "~/providers/types"

const APP_DIR = [
  process.env.HOME || process.env.USERPROFILE || "~",
  ".local",
  "share",
  "omnimodel",
].join("/")

const CONFIG_DIR = [
  process.env.HOME || process.env.USERPROFILE || "~",
  ".config",
  "omnimodel",
].join("/")

const PROVIDERS_DIR = `${APP_DIR}/providers`

const GITHUB_TOKEN_PATH = `${APP_DIR}/github_token`

export const PATHS = {
  APP_DIR,
  CONFIG_DIR,
  PROVIDERS_DIR,
  GITHUB_TOKEN_PATH,
  GITHUB_USER_PATH: `${APP_DIR}/github_user`,
  CONFIG_FILE: `${CONFIG_DIR}/config.json`,
  getProviderTokenPath: (providerId: ProviderID) =>
    `${PROVIDERS_DIR}/${providerId}_token`,
  getInstanceTokenPath: (instanceId: string) =>
    `${PROVIDERS_DIR}/${instanceId}_token`,
  getProviderConfigPath: (providerId: ProviderID) =>
    `${PROVIDERS_DIR}/${providerId}_config.json`,
}

export async function ensurePaths(): Promise<void> {
  // Create main app directory
  try {
    const stat = await Bun.file(PATHS.APP_DIR).exists()
    if (!stat) {
      await Bun.$`mkdir -p ${PATHS.APP_DIR}`.quiet()
    }
  } catch {
    await Bun.$`mkdir -p ${PATHS.APP_DIR}`.quiet()
  }

  // Create config directory
  try {
    const stat = await Bun.file(PATHS.CONFIG_DIR).exists()
    if (!stat) {
      await Bun.$`mkdir -p ${PATHS.CONFIG_DIR}`.quiet()
    }
  } catch {
    await Bun.$`mkdir -p ${PATHS.CONFIG_DIR}`.quiet()
  }

  // Create providers directory
  try {
    const providersDir = Bun.file(PATHS.PROVIDERS_DIR)
    const stat = await providersDir.exists()
    if (!stat) {
      await Bun.$`mkdir -p ${PATHS.PROVIDERS_DIR}`.quiet()
    }
  } catch {
    await Bun.$`mkdir -p ${PATHS.PROVIDERS_DIR}`.quiet()
  }
}
