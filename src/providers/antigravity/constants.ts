// Antigravity OAuth 2.0 authentication constants
// From: https://github.com/router-for-me/CLIProxyAPI
// Note: CLIENT_ID and CLIENT_SECRET should be provided via environment variables.
// Use placeholder values below for development.

export const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID ?? ""
export const ANTIGRAVITY_CLIENT_SECRET =
  process.env.ANTIGRAVITY_CLIENT_SECRET ?? ""
export const ANTIGRAVITY_CALLBACK_PORT = 51121

export const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
]

export const ANTIGRAVITY_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
export const ANTIGRAVITY_AUTH_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth"
export const ANTIGRAVITY_USERINFO_ENDPOINT =
  "https://www.googleapis.com/oauth2/v1/userinfo?alt=json"

export const ANTIGRAVITY_API_ENDPOINT = "https://cloudcode-pa.googleapis.com"
export const ANTIGRAVITY_API_VERSION = "v1internal"
export const ANTIGRAVITY_USER_AGENT = "antigravity/1.19.6"
export const ANTIGRAVITY_API_CLIENT =
  "google-cloud-sdk vscode_cloudshelleditor/0.1"
export const ANTIGRAVITY_CLIENT_METADATA =
  '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'

// Token refresh skew: refresh token 50 minutes before expiry
export const ANTIGRAVITY_REFRESH_SKEW_SECONDS = 50 * 60
