// Alibaba Cloud (DashScope/Qwen) OAuth 2.0 device code flow constants
// Source: https://github.com/router-for-me/CLIProxyAPI

export const ALIBABA_OAUTH_DEVICE_CODE_ENDPOINT =
  "https://chat.qwen.ai/api/v1/oauth2/device/code"
export const ALIBABA_OAUTH_TOKEN_ENDPOINT =
  "https://chat.qwen.ai/api/v1/oauth2/token"
export const ALIBABA_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56"
export const ALIBABA_OAUTH_SCOPE = "openid profile email model.completion"
export const ALIBABA_OAUTH_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:device_code"

// China region (default)
export const ALIBABA_BASE_URL_CHINA =
  "https://dashscope.aliyuncs.com/compatible-mode/v1"
// International region
export const ALIBABA_BASE_URL_GLOBAL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

export const ALIBABA_DEFAULT_BASE_URL = ALIBABA_BASE_URL_CHINA

export const ALIBABA_USER_AGENT = "QwenCode/0.13.2 (darwin; arm64)"

// Token refresh skew: refresh token 5 minutes before expiry
export const ALIBABA_REFRESH_SKEW_MS = 5 * 60 * 1000
