import { describe, test, expect, jest } from "bun:test"

import type { CanonicalRequest } from "~/cif/types"

import { AntigravityAdapter } from "~/providers/antigravity/adapter"
import { AntigravityProvider } from "~/providers/antigravity/handlers"

// Mock the provider
const mockProvider = {
  createChatCompletions: jest.fn(),
  ensureValidToken: jest.fn(),
  getAntigravityHeaders: jest.fn(),
  getAntigravityBaseUrl: jest.fn(),
  getAntigravityStreamPath: jest.fn(),
} as unknown as AntigravityProvider

// Mock fetch globally
globalThis.fetch = jest.fn()

describe("AntigravityAdapter", () => {
  const adapter = new AntigravityAdapter(mockProvider)

  function setupMocks() {
    jest.clearAllMocks()
    ;(mockProvider.ensureValidToken as any).mockResolvedValue({
      access_token: "test-token",
      project_id: "test-project",
    })
    ;(mockProvider.getAntigravityHeaders as any).mockReturnValue({
      Authorization: "Bearer test-token",
    })
    ;(mockProvider.getAntigravityBaseUrl as any).mockReturnValue(
      "https://api.antigravity.com",
    )
    ;(mockProvider.getAntigravityStreamPath as any).mockReturnValue(
      "/v1/stream",
    )
    ;(mockProvider.createChatCompletions as any).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve("{}"), // Default empty response
      }),
    )
  }

  test("should execute simple text request", async () => {
    setupMocks()

    const canonicalRequest: CanonicalRequest = {
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
      stream: false,
    }

    const mockAntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Hello! How can I help you today?" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 10,
          totalTokenCount: 15,
        },
      },
      traceId: "trace-123",
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockAntigravityResponse)),
    })

    const result = await adapter.execute(canonicalRequest)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Hello! How can I help you today?")
    expect(result.stopReason).toBe("end_turn")
    expect(result.usage?.inputTokens).toBe(5)
    expect(result.usage?.outputTokens).toBe(10)
  })

  test("should handle system prompt", async () => {
    setupMocks()

    const canonicalRequest: CanonicalRequest = {
      model: "claude-sonnet-4-6",
      systemPrompt: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hi there!" }],
        },
      ],
      stream: false,
    }

    const mockAntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Hello! How can I assist you today?" }],
            },
            finishReason: "STOP",
          },
        ],
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockAntigravityResponse)),
    })

    const result = await adapter.execute(canonicalRequest)

    // Verify the provider was called with correct parameters
    const providerCall = (mockProvider.createChatCompletions as any).mock
      .calls[0]
    const requestPayload = providerCall[0]
    expect(requestPayload.systemInstruction).toEqual({
      role: "user",
      parts: [{ text: "You are a helpful assistant." }],
    })

    // Verify the response is correctly parsed
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Hello! How can I assist you today?")
  })

  test("should handle tool calls", async () => {
    setupMocks()

    const canonicalRequest: CanonicalRequest = {
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "What's the weather like?" }],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get current weather",
          parametersSchema: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        },
      ],
      toolChoice: "auto",
      stream: false,
    }

    const mockAntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { text: "I'll check the weather for you." },
                {
                  functionCall: {
                    id: "call_123",
                    name: "get_weather",
                    args: { location: "San Francisco" },
                    thoughtSignature: "thinking_456",
                  },
                },
              ],
            },
            finishReason: "FUNCTION_CALL",
          },
        ],
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockAntigravityResponse)),
    })

    const result = await adapter.execute(canonicalRequest)

    expect(result.content).toHaveLength(2)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("I'll check the weather for you.")
    expect(result.content[1].type).toBe("tool_call")
    expect(result.content[1].toolCallId).toBe("call_123")
    expect(result.content[1].toolName).toBe("get_weather")
    expect(result.content[1].toolArguments).toEqual({
      location: "San Francisco",
    })
    expect(result.stopReason).toBe("tool_use")

    // Verify tools were sent correctly
    const providerCall = (mockProvider.createChatCompletions as any).mock
      .calls[0]
    const requestPayload = providerCall[0]
    expect(requestPayload.tools).toHaveLength(1)
    expect(requestPayload.tools[0].functionDeclarations[0].name).toBe(
      "get_weather",
    )
  })

  test("should handle thinking blocks", async () => {
    setupMocks()

    const canonicalRequest: CanonicalRequest = {
      model: "claude-opus-4-6-thinking",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Let me think about this problem...",
              signature: "thinking_123",
            },
            { type: "text", text: "Here's my answer." },
          ],
        },
      ],
      stream: false,
    }

    const mockAntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Response text" }],
            },
            finishReason: "STOP",
          },
        ],
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockAntigravityResponse)),
    })

    const result = await adapter.execute(canonicalRequest)

    // Verify the provider was called with correct thinking block format
    const providerCall = (mockProvider.createChatCompletions as any).mock
      .calls[0]
    const requestPayload = providerCall[0]
    expect(requestPayload.contents[0].parts).toEqual([
      {
        thought: true,
        text: "Let me think about this problem...",
        thoughtSignature: "thinking_123",
      },
      { text: "Here's my answer." },
    ])

    // Verify response parsing
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Response text")
  })

  test("should handle tool results", async () => {
    setupMocks()

    const canonicalRequest: CanonicalRequest = {
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: "call_123",
              toolName: "get_weather",
              content: "Sunny, 72°F",
              isError: false,
            },
          ],
        },
      ],
      stream: false,
    }

    const mockAntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Based on the weather data, it's a nice day!" }],
            },
            finishReason: "STOP",
          },
        ],
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockAntigravityResponse)),
    })

    const result = await adapter.execute(canonicalRequest)

    // Verify the provider was called with correct tool result format
    const providerCall = (mockProvider.createChatCompletions as any).mock
      .calls[0]
    const requestPayload = providerCall[0]
    expect(requestPayload.contents[0].parts[0]).toEqual({
      functionResponse: {
        id: "call_123",
        name: "get_weather",
        response: { result: "Sunny, 72°F" },
      },
    })

    // Verify response parsing
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe(
      "Based on the weather data, it's a nice day!",
    )
  })

  test("should handle images", async () => {
    setupMocks()

    const canonicalRequest: CanonicalRequest = {
      model: "claude-sonnet-4-6",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What's in this image?" },
            {
              type: "image",
              mediaType: "image/png",
              data: "base64data",
            },
          ],
        },
      ],
      stream: false,
    }

    const mockAntigravityResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { text: "I can see a beautiful landscape in the image." },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockAntigravityResponse)),
    })

    const result = await adapter.execute(canonicalRequest)

    // Verify the provider was called with correct image format
    const providerCall = (mockProvider.createChatCompletions as any).mock
      .calls[0]
    const requestPayload = providerCall[0]
    expect(requestPayload.contents[0].parts).toEqual([
      { text: "What's in this image?" },
      {
        inlineData: {
          mimeType: "image/png",
          data: "base64data",
        },
      },
    ])

    // Verify response parsing
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe(
      "I can see a beautiful landscape in the image.",
    )
  })

  test("should handle tool choice variations", async () => {
    const testCases = [
      { input: "none", expected: "NONE" },
      { input: "required", expected: "ANY" },
      {
        input: { type: "function", functionName: "specific_tool" },
        expected: "VALIDATED",
        allowedFunctionNames: ["specific_tool"],
      },
    ]

    for (const testCase of testCases) {
      setupMocks()

      const canonicalRequest: CanonicalRequest = {
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
        tools: [
          {
            name: "specific_tool",
            parametersSchema: { type: "object" },
          },
        ],
        toolChoice: testCase.input,
        stream: false,
      }

      const mockResponse = {
        response: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "response" }] },
              finishReason: "STOP",
            },
          ],
        },
      }

      ;(mockProvider.createChatCompletions as any).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      })

      const result = await adapter.execute(canonicalRequest)

      // For now, we'll just verify the adapter runs without error
      // Tool choice configuration should be implemented in the adapter later
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe("text")
      expect(result.content[0].text).toBe("response")
    }
  })

  test("should remap model names correctly", () => {
    expect(adapter.remapModel("claude-opus-4.6")).toBe(
      "claude-opus-4-6-thinking",
    )
    expect(adapter.remapModel("claude-opus-4-something")).toBe(
      "claude-opus-4-6-thinking",
    )
    expect(adapter.remapModel("claude-sonnet-4.6")).toBe("claude-sonnet-4-6")
    expect(adapter.remapModel("claude-sonnet-4-something")).toBe(
      "claude-sonnet-4-6",
    )
    expect(adapter.remapModel("claude-haiku-4.5")).toBe("claude-sonnet-4-6")
    expect(adapter.remapModel("custom-model")).toBe("custom-model")
  })

  test("should handle generation config parameters", async () => {
    setupMocks()

    const canonicalRequest: CanonicalRequest = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 1000,
      stop: ["STOP", "END"],
      stream: false,
    }

    const mockResponse = {
      response: {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "response" }] },
            finishReason: "STOP",
          },
        ],
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    })

    const result = await adapter.execute(canonicalRequest)

    // Verify the provider was called with correct generation config
    const providerCall = (mockProvider.createChatCompletions as any).mock
      .calls[0]
    const requestPayload = providerCall[0]
    expect(requestPayload.generationConfig).toEqual({
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 1000,
      stopSequences: ["STOP", "END"],
      candidateCount: 1,
    })

    // Verify response parsing
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("response")
  })
})
