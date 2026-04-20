import type { OpenCodeConfig, AMPConfig, DroidConfig } from '../types'

// ─── Config Normalization Helpers ──────────────────────────────────────────────

export function normalizeOpenCodeConfig(parsed: unknown): OpenCodeConfig {
  const config = parsed as OpenCodeConfig
  return {
    ...config,
    features: config.features ?? {},
    mcp: config.mcp ?? { servers: [] },
    skills: config.skills ?? { paths: [] },
  }
}

export function createEmptyOpenCodeConfig(): OpenCodeConfig {
  return {
    features: {},
    mcp: { servers: [] },
    skills: { paths: [] },
  }
}

export function normalizeAMPConfig(parsed: unknown): AMPConfig {
  const config = parsed as AMPConfig
  return {
    ...config,
    models: config.models ?? { default: '', providers: [], custom: [] },
    features: config.features ?? {},
    ui: config.ui ?? {},
    logging: config.logging ?? {},
  }
}

export function createEmptyAMPConfig(): AMPConfig {
  return {
    models: { default: '', providers: [], custom: [] },
    features: {},
    ui: {},
    logging: {},
  }
}

export function normalizeDroidConfig(parsed: unknown): DroidConfig {
  const config = parsed as DroidConfig
  return {
    ...config,
    customModels: config.customModels ?? [],
    providers: config.providers ?? { default: {} },
    features: config.features ?? {},
    logging: config.logging ?? {},
    ui: config.ui ?? {},
    enabledPlugins: config.enabledPlugins ?? {},
  }
}

export function createEmptyDroidConfig(): DroidConfig {
  return {
    customModels: [],
    providers: { default: {} },
    features: {},
    logging: {},
    ui: {},
    enabledPlugins: {},
  }
}
