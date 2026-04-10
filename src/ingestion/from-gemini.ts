import type { CanonicalRequest } from "~/cif/types"

/**
 * Placeholder types for future Gemini native API support
 */
export interface GeminiPayload {
  // TODO: Define Gemini native request format
  model: string
  contents: Array<unknown>
  generationConfig?: unknown
  tools?: Array<unknown>
  // ... other Gemini fields
}

/**
 * Convert Gemini API payload to CanonicalRequest
 *
 * @throws Not implemented yet
 */
export function parseGeminiMessages(_payload: GeminiPayload): CanonicalRequest {
  throw new Error(
    "Gemini native ingestion not yet implemented. Use /model gpt-5.3-codex to access Gemini models via Antigravity provider.",
  )

  // TODO: Implement Gemini → CIF conversion
  // This will likely be similar to the Antigravity format since Gemini is the upstream
  //
  // return {
  //   model: payload.model,
  //   systemPrompt: extractSystemInstruction(payload.systemInstruction),
  //   messages: translateGeminiContents(payload.contents),
  //   tools: translateGeminiTools(payload.tools),
  //   ...
  // }
}
