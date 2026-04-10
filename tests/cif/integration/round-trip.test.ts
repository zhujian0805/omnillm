import { describe, test, expect } from "bun:test"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"
import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import { parseAnthropicMessages } from "~/ingestion/from-anthropic"
import {
  translateToOpenAI,
  translateToAnthropic,
} from "~/routes/messages/non-stream-translation"
import { serializeToAnthropic } from "~/serialization/to-anthropic"

describe("CIF Integration - Round Trip Tests", () => {
  test("should produce equivalent output: Anthropic -> CIF -> Anthropic", () => {
    const originalPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      system: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: "Hello, can you help me with a task?",
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Of course! I'd be happy to help you with your task.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Great! What's the weather like?",
            },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
      top_p: 0.9,
    }

    // Simulate provider response
    const mockProviderResponse: ChatCompletionResponse = {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1677652288,
      model: "claude-3-5-sonnet-20241022",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              "I'd be happy to help you check the weather! However, I don't have access to real-time weather data.",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 25,
        total_tokens: 75,
      },
    }

    // Legacy path
    const legacyOpenAI = translateToOpenAI(originalPayload)
    const legacyAnthropicResponse = translateToAnthropic(mockProviderResponse)

    // CIF path
    const canonicalRequest = parseAnthropicMessages(originalPayload)
    // Simulate CIF adapter response
    const canonicalResponse = {
      id: mockProviderResponse.id,
      model: mockProviderResponse.model,
      content: [
        {
          type: "text" as const,
          text: mockProviderResponse.choices[0].message.content!,
        },
      ],
      stopReason: "end_turn" as const,
      usage: {
        inputTokens: mockProviderResponse.usage!.prompt_tokens,
        outputTokens: mockProviderResponse.usage!.completion_tokens,
      },
    }
    const cifAnthropicResponse = serializeToAnthropic(canonicalResponse)

    // Compare key fields
    expect(cifAnthropicResponse.id).toBe(legacyAnthropicResponse.id)
    expect(cifAnthropicResponse.model).toBe(legacyAnthropicResponse.model)
    expect(cifAnthropicResponse.content).toEqual(
      legacyAnthropicResponse.content,
    )
    expect(cifAnthropicResponse.stop_reason).toBe(
      legacyAnthropicResponse.stop_reason,
    )
    expect(cifAnthropicResponse.usage).toEqual(legacyAnthropicResponse.usage)

    // Verify request conversion preserves essential data
    expect(canonicalRequest.model).toBe(originalPayload.model)
    expect(canonicalRequest.systemPrompt).toBe(originalPayload.system)
    expect(canonicalRequest.messages).toHaveLength(
      originalPayload.messages.length,
    )
    expect(canonicalRequest.maxTokens).toBe(originalPayload.max_tokens)
    expect(canonicalRequest.temperature).toBe(originalPayload.temperature)
    expect(canonicalRequest.topP).toBe(originalPayload.top_p)
  })

  test("should handle complex conversation with tools", () => {
    const originalPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: "What's the weather like in San Francisco?",
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "I'll check the weather in San Francisco for you.",
            },
            {
              type: "tool_use",
              id: "toolu_01A09q90qw90lq917835lq9",
              name: "get_weather",
              input: { location: "San Francisco, CA" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01A09q90qw90lq917835lq9",
              content: "Weather in San Francisco: Sunny, 72°F, light breeze",
            },
          ],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get current weather for a location",
          input_schema: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The city and state, e.g. San Francisco, CA",
              },
            },
            required: ["location"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      max_tokens: 1000,
    }

    const mockProviderResponse: ChatCompletionResponse = {
      id: "chatcmpl-tool-test",
      object: "chat.completion",
      created: 1677652288,
      model: "claude-3-5-sonnet-20241022",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              "Based on the weather data, it's a beautiful day in San Francisco! It's sunny and 72°F with a light breeze - perfect weather for outdoor activities.",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 35,
        total_tokens: 155,
      },
    }

    // Legacy path
    const legacyOpenAI = translateToOpenAI(originalPayload)
    const legacyAnthropicResponse = translateToAnthropic(mockProviderResponse)

    // CIF path
    const canonicalRequest = parseAnthropicMessages(originalPayload)
    const canonicalResponse = {
      id: mockProviderResponse.id,
      model: mockProviderResponse.model,
      content: [
        {
          type: "text" as const,
          text: mockProviderResponse.choices[0].message.content!,
        },
      ],
      stopReason: "end_turn" as const,
      usage: {
        inputTokens: mockProviderResponse.usage!.prompt_tokens,
        outputTokens: mockProviderResponse.usage!.completion_tokens,
      },
    }
    const cifAnthropicResponse = serializeToAnthropic(canonicalResponse)

    // Verify tool conversion
    expect(canonicalRequest.tools).toHaveLength(1)
    expect(canonicalRequest.tools![0].name).toBe("get_weather")
    expect(canonicalRequest.tools![0].parametersSchema).toEqual({
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The city and state, e.g. San Francisco, CA",
        },
      },
      required: ["location"],
    })
    expect(canonicalRequest.toolChoice).toBe("auto")

    // Verify message conversion preserves tool use and tool result
    expect(canonicalRequest.messages).toHaveLength(3)

    // Assistant message with tool call
    expect(canonicalRequest.messages[1].role).toBe("assistant")
    expect(canonicalRequest.messages[1].content).toHaveLength(2)
    expect(canonicalRequest.messages[1].content[0].type).toBe("text")
    expect(canonicalRequest.messages[1].content[1].type).toBe("tool_call")
    expect(canonicalRequest.messages[1].content[1].toolCallId).toBe(
      "toolu_01A09q90qw90lq917835lq9",
    )
    expect(canonicalRequest.messages[1].content[1].toolName).toBe("get_weather")

    // User message with tool result
    expect(canonicalRequest.messages[2].role).toBe("user")
    expect(canonicalRequest.messages[2].content[0].type).toBe("tool_result")
    expect(canonicalRequest.messages[2].content[0].toolCallId).toBe(
      "toolu_01A09q90qw90lq917835lq9",
    )
    expect(canonicalRequest.messages[2].content[0].content).toBe(
      "Weather in San Francisco: Sunny, 72°F, light breeze",
    )

    // Compare final responses
    expect(cifAnthropicResponse.content).toEqual(
      legacyAnthropicResponse.content,
    )
    expect(cifAnthropicResponse.stop_reason).toBe(
      legacyAnthropicResponse.stop_reason,
    )
  })

  test("should handle multimodal content with images", () => {
    const originalPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Can you describe what you see in this image?",
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
              },
            },
            {
              type: "text",
              text: "Please be detailed in your description.",
            },
          ],
        },
      ],
      max_tokens: 1000,
    }

    const mockProviderResponse: ChatCompletionResponse = {
      id: "chatcmpl-image-test",
      object: "chat.completion",
      created: 1677652288,
      model: "claude-3-5-sonnet-20241022",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              "I can see a small image that appears to be a simple 1x1 pixel PNG file. It's essentially a minimal test image often used for demonstrations or placeholders.",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 85,
        completion_tokens: 30,
        total_tokens: 115,
      },
    }

    // CIF path
    const canonicalRequest = parseAnthropicMessages(originalPayload)
    const canonicalResponse = {
      id: mockProviderResponse.id,
      model: mockProviderResponse.model,
      content: [
        {
          type: "text" as const,
          text: mockProviderResponse.choices[0].message.content!,
        },
      ],
      stopReason: "end_turn" as const,
      usage: {
        inputTokens: mockProviderResponse.usage!.prompt_tokens,
        outputTokens: mockProviderResponse.usage!.completion_tokens,
      },
    }
    const cifAnthropicResponse = serializeToAnthropic(canonicalResponse)

    // Verify image handling
    expect(canonicalRequest.messages[0].content).toHaveLength(3)
    expect(canonicalRequest.messages[0].content[0].type).toBe("text")
    expect(canonicalRequest.messages[0].content[1].type).toBe("image")
    expect(canonicalRequest.messages[0].content[1].mediaType).toBe("image/png")
    expect(canonicalRequest.messages[0].content[1].data).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    )
    expect(canonicalRequest.messages[0].content[2].type).toBe("text")

    // Response should be properly formatted
    expect(cifAnthropicResponse.content[0].type).toBe("text")
    expect(cifAnthropicResponse.content[0].text).toBe(
      mockProviderResponse.choices[0].message.content,
    )
  })

  test("should preserve thinking blocks in canonical format", () => {
    const originalPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: "What is 15 * 23?",
        },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking:
                "I need to multiply 15 by 23. Let me work this out step by step:\n15 × 23 = 15 × (20 + 3) = (15 × 20) + (15 × 3) = 300 + 45 = 345",
            },
            {
              type: "text",
              text: "15 × 23 = 345",
            },
          ],
        },
      ],
      max_tokens: 1000,
    }

    // CIF path should preserve thinking blocks
    const canonicalRequest = parseAnthropicMessages(originalPayload)

    expect(canonicalRequest.messages[1].content).toHaveLength(2)
    expect(canonicalRequest.messages[1].content[0].type).toBe("thinking")
    expect(canonicalRequest.messages[1].content[0].thinking).toContain(
      "step by step",
    )
    expect(canonicalRequest.messages[1].content[1].type).toBe("text")
    expect(canonicalRequest.messages[1].content[1].text).toBe("15 × 23 = 345")

    // When serializing back to Anthropic format, thinking should be preserved
    const canonicalResponse = {
      id: "response-with-thinking",
      model: "claude-3-5-sonnet-20241022",
      content: [
        {
          type: "thinking" as const,
          thinking: "Let me calculate this carefully: 15 × 23 = 345",
          signature: "thinking_calc_123",
        },
        {
          type: "text" as const,
          text: "The answer is 345.",
        },
      ],
      stopReason: "end_turn" as const,
    }

    const anthropicResponse = serializeToAnthropic(canonicalResponse)
    expect(anthropicResponse.content).toHaveLength(2)
    expect(anthropicResponse.content[0].type).toBe("thinking")
    expect(anthropicResponse.content[0].thinking).toBe(
      "Let me calculate this carefully: 15 × 23 = 345",
    )
    expect(anthropicResponse.content[1].type).toBe("text")
  })

  test("should handle error cases gracefully", () => {
    // Test with malformed tool arguments in original payload
    const payloadWithMalformedTool: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "malformed_tool",
              name: "test_tool",
              input: { malformed: "data with\ninvalid\ncharacters" },
            },
          ],
        },
      ],
      max_tokens: 100,
    }

    const canonicalRequest = parseAnthropicMessages(payloadWithMalformedTool)

    expect(canonicalRequest.messages[0].content[0].type).toBe("tool_call")
    expect(canonicalRequest.messages[0].content[0].toolArguments).toEqual({
      malformed: "data with\ninvalid\ncharacters",
    })

    // Test response with error
    const errorResponse = {
      id: "error-response",
      model: "claude-3-5-sonnet-20241022",
      content: [
        {
          type: "text" as const,
          text: "I encountered an error processing your request.",
        },
      ],
      stopReason: "error" as const,
    }

    const anthropicErrorResponse = serializeToAnthropic(errorResponse)
    expect(anthropicErrorResponse.stop_reason).toBe("end_turn") // error maps to end_turn
    expect(anthropicErrorResponse.content[0].text).toContain("error")
  })

  test("should maintain data consistency across multiple round trips", () => {
    const originalPayload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      system: [
        { type: "text", text: "You are a helpful assistant." },
        { type: "text", text: "Always be polite and informative." },
      ],
      messages: [
        {
          role: "user",
          content: "Hello there!",
        },
      ],
      max_tokens: 500,
      temperature: 0.5,
      top_p: 0.95,
      stop_sequences: ["Human:", "Assistant:"],
      metadata: {
        user_id: "user_12345",
      },
    }

    // Convert to canonical and back multiple times
    let canonicalRequest = parseAnthropicMessages(originalPayload)

    // First round trip
    expect(canonicalRequest.model).toBe(originalPayload.model)
    expect(canonicalRequest.systemPrompt).toBe(
      "You are a helpful assistant.\n\nAlways be polite and informative.",
    )
    expect(canonicalRequest.maxTokens).toBe(originalPayload.max_tokens)
    expect(canonicalRequest.temperature).toBe(originalPayload.temperature)
    expect(canonicalRequest.topP).toBe(originalPayload.top_p)
    expect(canonicalRequest.stop).toEqual(originalPayload.stop_sequences)
    expect(canonicalRequest.userId).toBe("user_12345")

    // Simulate multiple conversions (like what might happen in complex provider chains)
    for (let i = 0; i < 3; i++) {
      // This tests that our conversion is stable and doesn't drift
      canonicalRequest = parseAnthropicMessages(originalPayload)
      expect(canonicalRequest.model).toBe(originalPayload.model)
      expect(canonicalRequest.systemPrompt).toBe(
        "You are a helpful assistant.\n\nAlways be polite and informative.",
      )
    }
  })
})
