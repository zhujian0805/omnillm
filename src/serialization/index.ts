// Serialization adapters — convert CanonicalResponse/Request to each output format
export {
  convertCIFMessagesToAnthropic,
  serializeToAnthropic,
} from "./to-anthropic"
// Streaming serialization adapters — convert CIFStreamEvent to format-specific SSE
export {
  type AnthropicStreamState,
  cifEventToAnthropicSSE,
  createAnthropicStreamState,
} from "./to-anthropic-stream"
export { convertContentPartsToOpenAI, serializeToOpenAI } from "./to-openai"
export { canonicalRequestToChatCompletionsPayload } from "./to-openai-payload"

export {
  cifEventToOpenAISSE,
  createOpenAIStreamState,
  type OpenAIStreamChunk,
  type OpenAIStreamState,
} from "./to-openai-stream"
export { serializeToResponses } from "./to-responses"
export {
  cifEventToResponsesSSE,
  createResponsesStreamState,
  type ResponsesStreamState,
} from "./to-responses-stream"
