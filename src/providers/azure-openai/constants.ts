// Azure OpenAI constants
// Docs: https://learn.microsoft.com/en-us/azure/ai-services/openai/

// Default API version — using stable version for better compatibility
export const AZURE_OPENAI_DEFAULT_API_VERSION = "2024-08-01-preview"

// Keep Azure defaults modest so omitted token limits don't become a latency tax.
export const AZURE_OPENAI_DEFAULT_MAX_OUTPUT_TOKENS = 1024

// Token refresh skew: api-key never expires, no refresh needed
export const AZURE_OPENAI_REFRESH_SKEW_MS = 5 * 60 * 1000
