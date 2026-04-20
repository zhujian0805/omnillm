// ─── API Types ──────────────────────────────────────────────────────────────

export interface ConfigFileEntry {
  name: string
  label: string
  description: string
  language: string
  exists: boolean
}

export interface ConfigFileContent {
  name: string
  label: string
  content: string
  exists: boolean
  message?: string
}

// ─── Claude Code Settings types ──────────────────────────────────────────────

export interface ClaudeCodeSettings {
  model?: string
  env?: Record<string, string>
  enabledPlugins?: Record<string, boolean>
  extraKnownMarketplaces?: Record<string, unknown>
  autoUpdatesChannel?: string
  skipDangerousModePermissionPrompt?: boolean
  [key: string]: unknown
}

// ─── Codex Config types ──────────────────────────────────────────────────────

export interface CodexModelProvider {
  name: string
  base_url: string
  env_key: string
}

export interface CodexProfile {
  name: string
  model: string
  model_provider: string
  model_reasoning_effort: string
  sandbox: string
}

export interface CodexConfig {
  model?: string
  model_reasoning_effort?: string
  profile?: string
  model_providers?: Record<string, CodexModelProvider>
  profiles?: Record<string, CodexProfile>
  projects?: Record<string, { trust_level: string }>
  [key: string]: unknown
}

// ─── OpenCode Config types ──────────────────────────────────────────────────────

export interface OpenCodeConfig {
  provider?: string
  model?: string
  endpoint?: string
  api_key_env?: string
  features?: {
    proxy_aware?: boolean
    auto_backup?: boolean
  }
  mcp?: {
    servers?: Array<unknown>
  }
  skills?: {
    paths?: Array<string>
  }
  generated_on?: string
  [key: string]: unknown
}

// ─── AMP Config types ──────────────────────────────────────────────────────

export interface AMPProvider {
  id: string
  name: string
  type: string
  base_url: string
  api_key: string
  timeout_ms?: number
  retry?: {
    max_attempts?: number
    backoff_multiplier?: number
    initial_delay_ms?: number
  }
}

export interface AMPModelCapability {
  chat?: boolean
  completion?: boolean
  vision?: boolean
  tools?: boolean
  functions?: boolean
  json_mode?: boolean
}

export interface AMPModel {
  id: string
  provider_id: string
  model_name: string
  display_name?: string
  capabilities?: AMPModelCapability
  limits?: {
    context_length?: number
    max_output_tokens?: number
  }
  defaults?: {
    temperature?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
  }
}

export interface AMPConfig {
  models?: {
    default?: string
    providers?: Array<AMPProvider>
    custom?: Array<AMPModel>
  }
  features?: {
    streaming?: boolean
    tool_use?: boolean
    auto_context?: boolean
    code_completion?: boolean
  }
  ui?: {
    theme?: string
    show_token_usage?: boolean
    show_model_selector?: boolean
  }
  logging?: {
    level?: string
    format?: string
  }
  [key: string]: unknown
}

// ─── Droid Config types ──────────────────────────────────────────────────────

export interface DroidModel {
  model: string
  id: string
  index?: number
  baseUrl: string
  apiKey: string
  displayName?: string
  maxOutputTokens?: number
  noImageSupport?: boolean
  provider: string
  enabled?: boolean
  capabilities?: Array<string>
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

export interface DroidConfig {
  customModels?: Array<DroidModel>
  providers?: {
    default?: {
      baseUrl: string
      apiKey: string
      timeout?: number
      retryAttempts?: number
      backoffMultiplier?: number
    }
  }
  features?: {
    streaming?: boolean
    toolUse?: boolean
    imageSupport?: boolean
    functionCalling?: boolean
  }
  logging?: {
    level?: string
    format?: string
    output?: string
  }
  ui?: {
    theme?: string
    logoAnimation?: string
    showModelSelector?: boolean
    showTokenUsage?: boolean
  }
  enabledPlugins?: Record<string, boolean>
  [key: string]: unknown
}
