import type {
  CanonicalRequest,
  CanonicalResponse,
  CIFStreamEvent,
} from "~/cif/types"
import type { ModelsResponse } from "~/services/copilot/get-models"

export type ProviderID =
  | "github-copilot"
  | "antigravity"
  | "alibaba"
  | "azure-openai"

export interface AuthOptions {
  force?: boolean
  clientId?: string
  clientSecret?: string
  githubToken?: string
}

export interface ProviderAdapter {
  readonly provider: Provider

  execute(request: CanonicalRequest): Promise<CanonicalResponse>
  executeStream(request: CanonicalRequest): AsyncGenerator<CIFStreamEvent>

  // Optional model remapping
  remapModel?(canonicalModel: string): string
}

export interface Provider {
  /** Provider type (e.g. "antigravity"). Multiple instances share the same type. */
  id: ProviderID
  /** Unique instance identifier (e.g. "antigravity-1", "antigravity-2"). Defaults to id for first instance. */
  instanceId: string
  name: string

  // Auth
  setupAuth(options?: AuthOptions): Promise<void>
  getToken(): string
  refreshToken(): Promise<void>

  // API Configuration
  getBaseUrl(): string
  getHeaders(forVision?: boolean): Record<string, string>

  // Models
  getModels(): Promise<ModelsResponse>

  // Requests - accept unknown to handle all payload variants
  /** @deprecated Use adapter.execute() and adapter.executeStream() instead. This legacy method will be removed once all providers have CIF adapters. */
  createChatCompletions(payload: Record<string, unknown>): Promise<Response>
  /** @deprecated Use CIF adapters for embeddings in the future */
  createEmbeddings(payload: Record<string, unknown>): Promise<Response>
  getUsage(): Promise<Response>

  // CIF Adapter (optional during migration)
  readonly adapter?: ProviderAdapter
}

export interface ProviderConfig {
  provider: ProviderID
  [key: string]: unknown
}
