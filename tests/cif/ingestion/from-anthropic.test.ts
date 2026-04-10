import { describe, test, expect } from "bun:test"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"

import { parseAnthropicMessages } from "~/ingestion/from-anthropic"

describe("parseAnthropicMessages", () => {
  test("should parse simple text message", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: "Hello world",
        },
      ],
      max_tokens: 1000,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.model).toBe("claude-3-5-sonnet-20241022")
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe("user")
    expect(result.messages[0].content).toHaveLength(1)
    expect(result.messages[0].content[0].type).toBe("text")
    expect(result.messages[0].content[0].text).toBe("Hello world")
    expect(result.maxTokens).toBe(1000)
    expect(result.stream).toBe(false)
  })

  test("should parse system prompt", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-sonnet-20240229",
      system: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: "Hi there!",
        },
      ],
      max_tokens: 500,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.systemPrompt).toBe("You are a helpful assistant.")
    expect(result.messages).toHaveLength(1)
  })

  test("should parse system prompt with text blocks", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-sonnet-20240229",
      system: [
        { type: "text", text: "You are a helpful assistant." },
        { type: "text", text: "Be concise and clear." },
      ],
      messages: [
        {
          role: "user",
          content: "Hi there!",
        },
      ],
      max_tokens: 500,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.systemPrompt).toBe(
      "You are a helpful assistant.\n\nBe concise and clear.",
    )
  })

  test("should parse user message with image", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What's in this image?",
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
              },
            },
          ],
        },
      ],
      max_tokens: 1000,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.messages[0].content).toHaveLength(2)
    expect(result.messages[0].content[0].type).toBe("text")
    expect(result.messages[0].content[0].text).toBe("What's in this image?")
    expect(result.messages[0].content[1].type).toBe("image")
    expect(result.messages[0].content[1].mediaType).toBe("image/png")
    expect(result.messages[0].content[1].data).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    )
  })

  test("should parse assistant message with thinking block", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: "What is 2+2?",
        },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "This is a simple math problem. 2 + 2 = 4.",
            },
            {
              type: "text",
              text: "The answer is 4.",
            },
          ],
        },
      ],
      max_tokens: 1000,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].role).toBe("assistant")
    expect(result.messages[1].content).toHaveLength(2)
    expect(result.messages[1].content[0].type).toBe("thinking")
    expect(result.messages[1].content[0].thinking).toBe(
      "This is a simple math problem. 2 + 2 = 4.",
    )
    expect(result.messages[1].content[1].type).toBe("text")
    expect(result.messages[1].content[1].text).toBe("The answer is 4.")
  })

  test("should parse tool use and tool result", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: "What's the weather like?",
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "I'll check the weather for you.",
            },
            {
              type: "tool_use",
              id: "toolu_01A09q90qw90lq917835lq9",
              name: "get_weather",
              input: { location: "San Francisco" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01A09q90qw90lq917835lq9",
              content: "Sunny, 72°F",
            },
          ],
        },
      ],
      max_tokens: 1000,
      tools: [
        {
          name: "get_weather",
          description: "Get current weather for a location",
          input_schema: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      ],
    }

    const result = parseAnthropicMessages(payload)

    expect(result.messages).toHaveLength(3)

    // Assistant message with tool use
    expect(result.messages[1].content).toHaveLength(2)
    expect(result.messages[1].content[1].type).toBe("tool_call")
    expect(result.messages[1].content[1].toolCallId).toBe(
      "toolu_01A09q90qw90lq917835lq9",
    )
    expect(result.messages[1].content[1].toolName).toBe("get_weather")
    expect(result.messages[1].content[1].toolArguments).toEqual({
      location: "San Francisco",
    })

    // User message with tool result
    expect(result.messages[2].content).toHaveLength(1)
    expect(result.messages[2].content[0].type).toBe("tool_result")
    expect(result.messages[2].content[0].toolCallId).toBe(
      "toolu_01A09q90qw90lq917835lq9",
    )
    expect(result.messages[2].content[0].content).toBe("Sunny, 72°F")

    // Tools
    expect(result.tools).toHaveLength(1)
    expect(result.tools![0].name).toBe("get_weather")
    expect(result.tools![0].description).toBe(
      "Get current weather for a location",
    )
  })

  test("should parse all parameters", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
      max_tokens: 2000,
      temperature: 0.7,
      top_p: 0.9,
      stop_sequences: ["STOP", "END"],
      stream: true,
      metadata: {
        user_id: "user123",
      },
      tool_choice: { type: "auto" },
    }

    const result = parseAnthropicMessages(payload)

    expect(result.model).toBe("claude-3-5-sonnet-20241022")
    expect(result.maxTokens).toBe(2000)
    expect(result.temperature).toBe(0.7)
    expect(result.topP).toBe(0.9)
    expect(result.stop).toEqual(["STOP", "END"])
    expect(result.stream).toBe(true)
    expect(result.userId).toBe("user123")
    expect(result.toolChoice).toBe("auto")
  })

  test("should handle tool choice variations", () => {
    const testCases = [
      { input: { type: "auto" }, expected: "auto" },
      { input: { type: "any" }, expected: "required" },
      {
        input: { type: "tool", name: "get_weather" },
        expected: { type: "function", functionName: "get_weather" },
      },
    ]

    for (const testCase of testCases) {
      const payload: AnthropicMessagesPayload = {
        model: "claude-3-sonnet-20240229",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 100,
        tool_choice: testCase.input,
        tools: [{ name: "get_weather", input_schema: { type: "object" } }],
      }

      const result = parseAnthropicMessages(payload)
      expect(result.toolChoice).toEqual(testCase.expected)
    }
  })

  test("should normalize tool input schema", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 100,
      tools: [
        {
          name: "test_tool",
          input_schema: {
            type: "object",
            properties: {
              param1: { type: "string" },
              param2: { type: "number", nullable: true },
            },
            required: ["param1"],
            patternProperties: { "^x-": { type: "string" } }, // Should be removed
            $schema: "http://json-schema.org/draft-07/schema#", // Should be removed
          },
        },
      ],
    }

    const result = parseAnthropicMessages(payload)

    const tool = result.tools![0]
    expect(tool.parametersSchema).toEqual({
      type: "object",
      properties: {
        param1: { type: "string" },
        param2: { type: ["number", "null"] },
      },
      required: ["param1"],
    })
  })

  test("should handle mixed content array", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this image and" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: "base64data",
              },
            },
            { type: "text", text: "tell me what you see." },
          ],
        },
      ],
      max_tokens: 1000,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.messages[0].content).toHaveLength(3)
    expect(result.messages[0].content[0].type).toBe("text")
    expect(result.messages[0].content[0].text).toBe("Analyze this image and")
    expect(result.messages[0].content[1].type).toBe("image")
    expect(result.messages[0].content[1].mediaType).toBe("image/jpeg")
    expect(result.messages[0].content[2].type).toBe("text")
    expect(result.messages[0].content[2].text).toBe("tell me what you see.")
  })

  test("should handle empty messages array", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-sonnet-20240229",
      messages: [],
      max_tokens: 100,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.messages).toHaveLength(0)
    expect(result.model).toBe("claude-3-sonnet-20240229")
  })

  test("should handle missing optional fields", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-sonnet-20240229",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 100,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.systemPrompt).toBeUndefined()
    expect(result.tools).toBeUndefined()
    expect(result.toolChoice).toBeUndefined()
    expect(result.temperature).toBeUndefined()
    expect(result.topP).toBeUndefined()
    expect(result.stop).toBeUndefined()
    expect(result.userId).toBeUndefined()
    expect(result.stream).toBe(false)
  })

  test("should handle tool result with error", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_error",
              content: "Tool execution failed",
              is_error: true,
            },
          ],
        },
      ],
      max_tokens: 100,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.messages[0].content[0].type).toBe("tool_result")
    expect(result.messages[0].content[0].isError).toBe(true)
    expect(result.messages[0].content[0].content).toBe("Tool execution failed")
  })

  test("should normalize tool result text blocks into a string", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_blocks",
              content: [
                { type: "text", text: '{"temperature":72}' },
                { type: "text", text: "Clear skies" },
              ],
            },
          ],
        },
      ],
      max_tokens: 100,
    }

    const result = parseAnthropicMessages(payload)

    expect(result.messages[0].content[0].type).toBe("tool_result")
    expect(result.messages[0].content[0].content).toBe(
      '{"temperature":72}\n\nClear skies',
    )
  })
})
