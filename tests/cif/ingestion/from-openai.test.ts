import { describe, test, expect } from "bun:test"

import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"

import { parseOpenAIChatCompletions } from "~/ingestion/from-openai"

describe("parseOpenAIChatCompletions", () => {
  test("should parse simple text message", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: "Hello world",
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.model).toBe("gpt-4")
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe("user")
    expect(result.messages[0].content).toHaveLength(1)
    expect(result.messages[0].content[0].type).toBe("text")
    expect(result.messages[0].content[0].text).toBe("Hello world")
    expect(result.stream).toBe(false)
  })

  test("should parse system message", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "user",
          content: "Hi there!",
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.systemPrompt).toBe("You are a helpful assistant.")
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe("user")
    expect(result.messages[0].content[0].text).toBe("Hi there!")
  })

  test("should merge multiple system messages", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "system",
          content: "Be concise and clear.",
        },
        {
          role: "user",
          content: "Hi there!",
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.systemPrompt).toBe(
      "You are a helpful assistant.\n\nBe concise and clear.",
    )
  })

  test("should parse user message with image", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What's in this image?",
            },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
              },
            },
          ],
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.messages[0].content).toHaveLength(2)
    expect(result.messages[0].content[0].type).toBe("text")
    expect(result.messages[0].content[0].text).toBe("What's in this image?")
    expect(result.messages[0].content[1].type).toBe("image")
    expect(result.messages[0].content[1].mediaType).toBe("image/png")
    expect(result.messages[0].content[1].data).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    )
  })

  test("should parse assistant message with tool calls", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: "What's the weather like?",
        },
        {
          role: "assistant",
          content: "I'll check the weather for you.",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "get_weather",
                arguments: JSON.stringify({ location: "San Francisco" }),
              },
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather for a location",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string" },
              },
              required: ["location"],
            },
          },
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].role).toBe("assistant")
    expect(result.messages[1].content).toHaveLength(2)
    expect(result.messages[1].content[0].type).toBe("text")
    expect(result.messages[1].content[0].text).toBe(
      "I'll check the weather for you.",
    )
    expect(result.messages[1].content[1].type).toBe("tool_call")
    expect(result.messages[1].content[1].toolCallId).toBe("call_123")
    expect(result.messages[1].content[1].toolName).toBe("get_weather")
    expect(result.messages[1].content[1].toolArguments).toEqual({
      location: "San Francisco",
    })

    // Tools
    expect(result.tools).toHaveLength(1)
    expect(result.tools![0].name).toBe("get_weather")
    expect(result.tools![0].description).toBe(
      "Get current weather for a location",
    )
  })

  test("should parse tool result message", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "Sunny, 72°F",
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe("user")
    expect(result.messages[0].content).toHaveLength(1)
    expect(result.messages[0].content[0].type).toBe("tool_result")
    expect(result.messages[0].content[0].toolCallId).toBe("call_123")
    expect(result.messages[0].content[0].content).toBe("Sunny, 72°F")
    expect(result.messages[0].content[0].isError).toBe(false)
  })

  test("should parse all parameters", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
      max_tokens: 2000,
      temperature: 0.7,
      top_p: 0.9,
      stop: ["STOP", "END"],
      stream: true,
      user: "user123",
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.model).toBe("gpt-4")
    expect(result.maxTokens).toBe(2000)
    expect(result.temperature).toBe(0.7)
    expect(result.topP).toBe(0.9)
    expect(result.stop).toEqual(["STOP", "END"])
    expect(result.stream).toBe(true)
    expect(result.userId).toBe("user123")
  })

  test("should handle tool choice variations", () => {
    const testCases = [
      { input: "auto", expected: "auto" },
      { input: "none", expected: "none" },
      { input: "required", expected: "required" },
      {
        input: { type: "function", function: { name: "get_weather" } },
        expected: { type: "function", functionName: "get_weather" },
      },
    ]

    for (const testCase of testCases) {
      const payload: ChatCompletionsPayload = {
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
        tool_choice: testCase.input,
        tools: [
          {
            type: "function",
            function: { name: "get_weather", parameters: {} },
          },
        ],
      }

      const result = parseOpenAIChatCompletions(payload)
      expect(result.toolChoice).toEqual(testCase.expected)
    }
  })

  test("should handle complex conversation with tools", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a weather assistant.",
        },
        {
          role: "user",
          content: "What's the weather in NYC?",
        },
        {
          role: "assistant",
          content: "I'll check the weather in New York City for you.",
          tool_calls: [
            {
              id: "call_weather_nyc",
              type: "function",
              function: {
                name: "get_weather",
                arguments: JSON.stringify({
                  location: "New York City",
                  units: "fahrenheit",
                }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_weather_nyc",
          content: "Temperature: 68°F, Conditions: Partly cloudy",
        },
        {
          role: "assistant",
          content:
            "The weather in NYC is partly cloudy with a temperature of 68°F.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather information",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string" },
                units: { type: "string", enum: ["celsius", "fahrenheit"] },
              },
              required: ["location"],
            },
          },
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.systemPrompt).toBe("You are a weather assistant.")
    expect(result.messages).toHaveLength(4)

    // User message
    expect(result.messages[0].role).toBe("user")
    expect(result.messages[0].content[0].text).toBe(
      "What's the weather in NYC?",
    )

    // Assistant message with tool call
    expect(result.messages[1].role).toBe("assistant")
    expect(result.messages[1].content).toHaveLength(2)
    expect(result.messages[1].content[0].type).toBe("text")
    expect(result.messages[1].content[1].type).toBe("tool_call")

    // Tool result converted to user message
    expect(result.messages[2].role).toBe("user")
    expect(result.messages[2].content[0].type).toBe("tool_result")

    // Final assistant message
    expect(result.messages[3].role).toBe("assistant")
    expect(result.messages[3].content[0].text).toBe(
      "The weather in NYC is partly cloudy with a temperature of 68°F.",
    )
  })

  test("should handle mixed content types in user message", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this chart:" },
            {
              type: "image_url",
              image_url: { url: "data:image/jpeg;base64,chartdata" },
            },
            { type: "text", text: "What trends do you see?" },
          ],
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.messages[0].content).toHaveLength(3)
    expect(result.messages[0].content[0].type).toBe("text")
    expect(result.messages[0].content[0].text).toBe("Look at this chart:")
    expect(result.messages[0].content[1].type).toBe("image")
    expect(result.messages[0].content[1].mediaType).toBe("image/jpeg")
    expect(result.messages[0].content[2].type).toBe("text")
    expect(result.messages[0].content[2].text).toBe("What trends do you see?")
  })

  test("should handle empty content", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: { name: "test_tool", arguments: "{}" },
            },
          ],
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.messages[0].content).toHaveLength(1)
    expect(result.messages[0].content[0].type).toBe("tool_call")
  })

  test("should handle malformed tool arguments", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [
        {
          role: "assistant",
          content: "Testing malformed JSON",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: { name: "test_tool", arguments: "invalid json{" },
            },
          ],
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.messages[0].content[1].type).toBe("tool_call")
    expect(result.messages[0].content[1].toolArguments).toEqual({
      _unparsable_arguments: "invalid json{",
    })
  })

  test("should handle stop parameter variations", () => {
    const testCases = [
      { input: "STOP", expected: ["STOP"] },
      { input: ["STOP", "END"], expected: ["STOP", "END"] },
    ]

    for (const testCase of testCases) {
      const payload: ChatCompletionsPayload = {
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
        stop: testCase.input,
      }

      const result = parseOpenAIChatCompletions(payload)
      expect(result.stop).toEqual(testCase.expected)
    }
  })

  test("should handle missing optional fields", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4",
      messages: [{ role: "user", content: "test" }],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.systemPrompt).toBeUndefined()
    expect(result.tools).toBeUndefined()
    expect(result.toolChoice).toBeUndefined()
    expect(result.temperature).toBeUndefined()
    expect(result.topP).toBeUndefined()
    expect(result.stop).toBeUndefined()
    expect(result.userId).toBeUndefined()
    expect(result.maxTokens).toBeUndefined()
    expect(result.stream).toBe(false)
  })

  test("should handle image URL without data URI", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://example.com/image.jpg" },
            },
          ],
        },
      ],
    }

    const result = parseOpenAIChatCompletions(payload)

    expect(result.messages[0].content).toHaveLength(1)
    expect(result.messages[0].content[0].type).toBe("image")
    expect(result.messages[0].content[0].url).toBe(
      "https://example.com/image.jpg",
    )
    expect(result.messages[0].content[0].data).toBeUndefined()
    expect(result.messages[0].content[0].mediaType).toBe("image/jpeg")
  })
})
