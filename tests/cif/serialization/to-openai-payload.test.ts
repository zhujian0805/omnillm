import { describe, test, expect } from "bun:test"

import type { CanonicalRequest } from "~/cif/types"

import { canonicalRequestToChatCompletionsPayload } from "~/serialization/to-openai-payload"

describe("canonicalRequestToChatCompletionsPayload", () => {
  test("should convert simple text request", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.model).toBe("gpt-4")
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe("user")
    expect(result.messages[0].content).toBe("Hello world")
    expect(result.stream).toBe(false)
  })

  test("should convert system prompt", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      systemPrompt: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hi there!" }],
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0].role).toBe("system")
    expect(result.messages[0].content).toBe("You are a helpful assistant.")
    expect(result.messages[1].role).toBe("user")
    expect(result.messages[1].content).toBe("Hi there!")
  })

  test("should convert user message with image", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4-vision-preview",
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

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages[0].content).toEqual([
      { type: "text", text: "What's in this image?" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,base64data" },
      },
    ])
  })

  test("should convert image with URL", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              mediaType: "image/jpeg",
              url: "https://example.com/image.jpg",
            },
          ],
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages[0].content).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://example.com/image.jpg" },
      },
    ])
  })

  test("should convert assistant message with tool calls", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "What's the weather?" }],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll check that for you." },
            {
              type: "tool_call",
              toolCallId: "call_123",
              toolName: "get_weather",
              toolArguments: { location: "San Francisco" },
            },
          ],
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].role).toBe("assistant")
    expect(result.messages[1].content).toBe("I'll check that for you.")
    expect(result.messages[1].tool_calls).toEqual([
      {
        id: "call_123",
        type: "function",
        function: {
          name: "get_weather",
          arguments: JSON.stringify({ location: "San Francisco" }),
        },
      },
    ])
  })

  test("should convert tool results to tool messages", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Regular user message" },
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

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0].role).toBe("tool")
    expect(result.messages[0].tool_call_id).toBe("call_123")
    expect(result.messages[0].content).toBe("Sunny, 72°F")
    expect(result.messages[1].role).toBe("user")
    expect(result.messages[1].content).toBe("Regular user message")
  })

  test("should handle thinking blocks by converting to text", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Let me think about this...",
              signature: "thinking_123",
            },
            { type: "text", text: "Here's my answer." },
          ],
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages[0].content).toBe(
      "Let me think about this...\n\nHere's my answer.",
    )
  })

  test("should convert tools", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
      tools: [
        {
          name: "get_weather",
          description: "Get current weather",
          parametersSchema: {
            type: "object",
            properties: {
              location: { type: "string" },
              units: { type: "string", enum: ["celsius", "fahrenheit"] },
            },
            required: ["location"],
          },
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.tools).toHaveLength(1)
    expect(result.tools![0]).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" },
            units: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["location"],
        },
      },
    })
  })

  test("should convert tool choice variations", () => {
    const testCases = [
      { input: "auto", expected: "auto" },
      { input: "none", expected: "none" },
      { input: "required", expected: "required" },
      {
        input: { type: "function", functionName: "get_weather" },
        expected: { type: "function", function: { name: "get_weather" } },
      },
    ]

    for (const testCase of testCases) {
      const canonicalRequest: CanonicalRequest = {
        model: "gpt-4",
        messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
        toolChoice: testCase.input,
        stream: false,
      }

      const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)
      expect(result.tool_choice).toEqual(testCase.expected)
    }
  })

  test("should convert all parameters", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2000,
      stop: ["STOP", "END"],
      stream: true,
      userId: "user123",
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.temperature).toBe(0.7)
    expect(result.top_p).toBe(0.9)
    expect(result.max_tokens).toBe(2000)
    expect(result.stop).toEqual(["STOP", "END"])
    expect(result.stream).toBe(false)
    expect(result.user).toBe("user123")
  })

  test("should handle complex conversation flow", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      systemPrompt: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "What's the weather in NYC?" }],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll check the weather for you." },
            {
              type: "tool_call",
              toolCallId: "call_weather",
              toolName: "get_weather",
              toolArguments: { location: "New York City" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: "call_weather",
              toolName: "get_weather",
              content: "Sunny, 72°F",
            },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "The weather in NYC is sunny and 72°F." },
          ],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get weather information",
          parametersSchema: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages).toHaveLength(6)

    // System message
    expect(result.messages[0].role).toBe("system")
    expect(result.messages[0].content).toBe("You are a helpful assistant.")

    // User message
    expect(result.messages[1].role).toBe("user")
    expect(result.messages[1].content).toBe("What's the weather in NYC?")

    // Assistant with tool call
    expect(result.messages[2].role).toBe("assistant")
    expect(result.messages[2].content).toBe("I'll check the weather for you.")
    expect(result.messages[2].tool_calls).toHaveLength(1)

    // Tool result
    expect(result.messages[3].role).toBe("tool")
    expect(result.messages[3].tool_call_id).toBe("call_weather")
    expect(result.messages[3].content).toBe("Sunny, 72°F")

    // Empty user message (since tool result was extracted)
    expect(result.messages[4].role).toBe("user")
    expect(result.messages[4].content).toBe("")

    // Final assistant response
    expect(result.messages[5].role).toBe("assistant")
    expect(result.messages[5].content).toBe(
      "The weather in NYC is sunny and 72°F.",
    )
  })

  test("should handle empty content arrays", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [],
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages[0].content).toBe("")
  })

  test("should handle mixed content with multiple tool results", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Here are the results:" },
            {
              type: "tool_result",
              toolCallId: "call_1",
              toolName: "tool1",
              content: "Result 1",
            },
            {
              type: "tool_result",
              toolCallId: "call_2",
              toolName: "tool2",
              content: "Result 2",
            },
            { type: "text", text: "What do you think?" },
          ],
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages).toHaveLength(3)
    expect(result.messages[0].role).toBe("tool")
    expect(result.messages[0].content).toBe("Result 1")
    expect(result.messages[1].role).toBe("tool")
    expect(result.messages[1].content).toBe("Result 2")
    expect(result.messages[2].role).toBe("user")
    expect(result.messages[2].content).toBe(
      "Here are the results:\n\nWhat do you think?",
    )
  })

  test("should handle assistant message with only tool calls", () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "call_123",
              toolName: "get_info",
              toolArguments: { query: "test" },
            },
          ],
        },
      ],
      stream: false,
    }

    const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

    expect(result.messages[0].content).toBeNull()
    expect(result.messages[0].tool_calls).toHaveLength(1)
  })
})
