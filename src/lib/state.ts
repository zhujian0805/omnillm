import type { Provider } from "~/providers/types"
import type { ModelsResponse } from "~/services/copilot/get-models"

export interface AuthFlow {
  providerId: string // Now instance ID, not provider type
  status: "pending" | "awaiting_user" | "complete" | "error"
  instructionURL?: string
  userCode?: string
  error?: string
}

export interface State {
  // Provider info
  currentProvider?: Provider
  selectedProviderID?: string // Now instance ID

  // Multi-provider active set (now instance IDs)
  activeProviderIDs: Set<string>

  // Per-provider cached models (keyed by instance ID)
  providerModels: Map<string, ModelsResponse>

  // Per-provider disabled model IDs (keyed by instance ID)
  disabledModels: Map<string, Set<string>>

  // Per-provider priority (keyed by instance ID, lower number = higher priority)
  providerPriorities: Map<string, number>

  // Legacy Copilot fields (kept for backwards compatibility)
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  manualApprove: boolean
  rateLimitWait: boolean
  showToken: boolean

  // Server port (set at startup)
  port: number

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number

  // Auth flow tracking for web UI hot-swap
  authFlow?: AuthFlow
}

export const state: State = {
  accountType: "individual",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
  port: 4141,
  activeProviderIDs: new Set(),
  providerModels: new Map(),
  disabledModels: new Map(),
  providerPriorities: new Map(),
}
