import { describe, test, expect } from "bun:test"

import type { AnthropicMessagesPayload } from "~/routes/messages/anthropic-types"
import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"

import { parseAnthropicMessages } from "~/ingestion/from-anthropic"
import { parseOpenAIChatCompletions } from "~/ingestion/from-openai"
import { canonicalRequestToChatCompletionsPayload } from "~/serialization/to-openai-payload"

describe("CIF Edge Cases and Error Handling", () => {
  describe("Input Validation", () => {
    test("should handle empty strings gracefully", () => {
      const payload: AnthropicMessagesPayload = {
        model: "",
        messages: [
          {
            role: "user",
            content: "",
          },
        ],
        max_tokens: 100,
      }

      const result = parseAnthropicMessages(payload)

      expect(result.model).toBe("")
      expect(result.messages[0].content[0].text).toBe("")
    })

    test("should handle null/undefined values in optional fields", () => {
      const payload = {
        model: "claude-3-sonnet-20240229",
        messages: [
          {
            role: "user",
            content: "test",
          },
        ],
        max_tokens: 100,
        system: undefined,
        tools: null,
        temperature: undefined,
        top_p: null,
      } as any

      const result = parseAnthropicMessages(payload)

      // For null values, the implementation should return undefined, not null
      expect(result.systemPrompt).toBeUndefined()
      expect(result.tools).toBeUndefined()
      expect(result.temperature).toBeUndefined()
      expect(result.topP).toBeUndefined()
    })

    test("should handle malformed JSON in tool arguments", () => {
      const payload: ChatCompletionsPayload = {
        model: "gpt-4",
        messages: [
          {
            role: "assistant",
            content: "Using tool",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "test_tool",
                  arguments: "{invalid json: true, missing quotes}",
                },
              },
            ],
          },
        ],
      }

      const result = parseOpenAIChatCompletions(payload)

      expect(result.messages[0].content[1].type).toBe("tool_call")
      expect(result.messages[0].content[1].toolArguments).toEqual({
        _unparsable_arguments: "{invalid json: true, missing quotes}",
      })
    })

    test("should handle extremely large content", () => {
      const largeText = "x".repeat(100000)
      const payload: AnthropicMessagesPayload = {
        model: "claude-3-5-sonnet-20241022",
        messages: [
          {
            role: "user",
            content: largeText,
          },
        ],
        max_tokens: 100,
      }

      const result = parseAnthropicMessages(payload)

      expect(result.messages[0].content[0].text).toBe(largeText)
      expect(result.messages[0].content[0].text.length).toBe(100000)
    })
  })

  describe("Edge Case Content Types", () => {
    test("should handle mixed content with empty blocks", () => {
      const payload: AnthropicMessagesPayload = {
        model: "claude-3-5-sonnet-20241022",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "" },
              { type: "text", text: "Hello" },
              { type: "text", text: "" },
              { type: "text", text: "World" },
            ],
          },
        ],
        max_tokens: 100,
      }

      const result = parseAnthropicMessages(payload)

      expect(result.messages[0].content).toHaveLength(4)
      expect(result.messages[0].content[0].text).toBe("")
      expect(result.messages[0].content[1].text).toBe("Hello")
      expect(result.messages[0].content[2].text).toBe("")
      expect(result.messages[0].content[3].text).toBe("World")
    })

    test("should handle tool results with complex content", () => {
      const complexToolResult = JSON.stringify({
        status: "success",
        data: {
          nested: { value: 42 },
          array: [1, 2, 3],
          null_value: null,
          unicode: "🚀 unicode text",
        },
      })

      const payload: AnthropicMessagesPayload = {
        model: "claude-3-5-sonnet-20241022",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "complex_result",
                content: complexToolResult,
              },
            ],
          },
        ],
        max_tokens: 100,
      }

      const result = parseAnthropicMessages(payload)

      expect(result.messages[0].content[0].type).toBe("tool_result")
      expect(result.messages[0].content[0].content).toBe(complexToolResult)
    })

    test("should handle images with various formats", () => {
      const testCases = [
        { mediaType: "image/jpeg", data: "jpeg_data_here" },
        { mediaType: "image/png", data: "png_data_here" },
        { mediaType: "image/webp", data: "webp_data_here" },
        { mediaType: "image/gif", data: "gif_data_here" },
      ]

      for (const testCase of testCases) {
        const payload: AnthropicMessagesPayload = {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: testCase.mediaType as any,
                    data: testCase.data,
                  },
                },
              ],
            },
          ],
          max_tokens: 100,
        }

        const result = parseAnthropicMessages(payload)

        expect(result.messages[0].content[0].type).toBe("image")
        expect(result.messages[0].content[0].mediaType).toBe(testCase.mediaType)
        expect(result.messages[0].content[0].data).toBe(testCase.data)
      }
    })
  })

  describe("Schema Normalization Edge Cases", () => {
    test("should handle deeply nested schemas", () => {
      const deepSchema = {
        type: "object",
        properties: {
          level1: {
            type: "object",
            properties: {
              level2: {
                type: "object",
                properties: {
                  level3: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        value: { type: "string", nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        $schema: "http://json-schema.org/draft-07/schema#", // Should be removed
        patternProperties: { "^x-": { type: "string" } }, // Should be removed
      }

      const payload: AnthropicMessagesPayload = {
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 100,
        tools: [
          {
            name: "deep_schema_tool",
            input_schema: deepSchema,
          },
        ],
      }

      const result = parseAnthropicMessages(payload)

      const normalizedSchema = result.tools![0].parametersSchema
      expect(normalizedSchema).not.toHaveProperty("$schema")
      expect(normalizedSchema).not.toHaveProperty("patternProperties")

      // Check that nested nullable was converted
      const level3Items = (normalizedSchema as any).properties.level1.properties
        .level2.properties.level3.items
      expect(level3Items.properties.value.type).toEqual(["string", "null"])
    })

    test("should handle invalid schema structures", () => {
      const invalidSchemas = [
        null,
        "string_instead_of_object",
        [],
        { type: "invalid_type" },
        { properties: "not_an_object" },
      ]

      for (const invalidSchema of invalidSchemas) {
        const payload: AnthropicMessagesPayload = {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 100,
          tools: [
            {
              name: "invalid_schema_tool",
              input_schema: invalidSchema as any,
            },
          ],
        }

        // Should not throw, should handle gracefully
        expect(() => parseAnthropicMessages(payload)).not.toThrow()
      }
    })
  })

  describe("Conversion Stress Tests", () => {
    test("should handle massive conversation history", () => {
      const massiveConversation = []
      for (let i = 0; i < 1000; i++) {
        massiveConversation.push(
          {
            role: "user" as const,
            content: `Message ${i}`,
          },
          {
            role: "assistant" as const,
            content: `Response ${i}`,
          },
        )
      }

      const payload: AnthropicMessagesPayload = {
        model: "claude-3-5-sonnet-20241022",
        messages: massiveConversation,
        max_tokens: 100,
      }

      const startTime = performance.now()
      const result = parseAnthropicMessages(payload)
      const endTime = performance.now()

      expect(result.messages).toHaveLength(2000)
      expect(endTime - startTime).toBeLessThan(1000) // Should complete in under 1 second
    })

    test("should handle many tools with complex schemas", () => {
      const manyTools = []
      for (let i = 0; i < 100; i++) {
        manyTools.push({
          name: `tool_${i}`,
          description: `Tool number ${i}`,
          input_schema: {
            type: "object",
            properties: {
              param1: { type: "string" },
              param2: { type: "number", nullable: true },
              param3: {
                type: "array",
                items: { type: "string" },
              },
              param4: {
                type: "object",
                properties: {
                  nested: { type: "boolean" },
                },
              },
            },
            required: ["param1"],
          },
        })
      }

      const payload: AnthropicMessagesPayload = {
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 100,
        tools: manyTools,
      }

      const result = parseAnthropicMessages(payload)

      expect(result.tools).toHaveLength(100)
      expect(result.tools![50].name).toBe("tool_50")
    })
  })

  describe("Serialization Edge Cases", () => {
    test("should handle canonical request with no messages", () => {
      const canonicalRequest = {
        model: "gpt-4",
        messages: [],
        stream: false,
      }

      const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

      expect(result.messages).toHaveLength(0)
    })

    test("should handle content with only tool calls", () => {
      const canonicalRequest = {
        model: "gpt-4",
        messages: [
          {
            role: "assistant" as const,
            content: [
              {
                type: "tool_call" as const,
                toolCallId: "call_1",
                toolName: "tool1",
                toolArguments: { arg1: "value1" },
              },
              {
                type: "tool_call" as const,
                toolCallId: "call_2",
                toolName: "tool2",
                toolArguments: { arg2: "value2" },
              },
            ],
          },
        ],
        stream: false,
      }

      const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

      expect(result.messages[0].content).toBeNull()
      expect(result.messages[0].tool_calls).toHaveLength(2)
    })

    test("should handle extremely large tool arguments", () => {
      const largeObject = {
        data: Array.from({ length: 10000 }, (_, i) => ({
          id: i,
          value: `item_${i}`,
        })),
        metadata: {
          description: "x".repeat(1000),
        },
      }

      const canonicalRequest = {
        model: "gpt-4",
        messages: [
          {
            role: "assistant" as const,
            content: [
              {
                type: "tool_call" as const,
                toolCallId: "large_call",
                toolName: "large_tool",
                toolArguments: largeObject,
              },
            ],
          },
        ],
        stream: false,
      }

      const result = canonicalRequestToChatCompletionsPayload(canonicalRequest)

      const toolCall = result.messages[0].tool_calls![0]
      const parsedArgs = JSON.parse(toolCall.function.arguments)
      expect(parsedArgs.data).toHaveLength(10000)
      expect(parsedArgs.metadata.description.length).toBe(1000)
    })
  })

  describe("Unicode and Special Characters", () => {
    test("should handle various Unicode characters", () => {
      const unicodeTests = [
        "Hello 🌍 World",
        "中文测试",
        "العربية",
        "Русский",
        "हिन्दी",
        "🚀🌟💡🎉🔥",
        "Math: ∑∫∂√∞±≤≥≠",
        "Symbols: ←→↑↓↩↪⤴⤵",
      ]

      for (const unicodeText of unicodeTests) {
        const payload: AnthropicMessagesPayload = {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: unicodeText,
            },
          ],
          max_tokens: 100,
        }

        const result = parseAnthropicMessages(payload)
        expect(result.messages[0].content[0].text).toBe(unicodeText)

        // Test round trip
        const openaiPayload = canonicalRequestToChatCompletionsPayload(result)
        expect(openaiPayload.messages[0].content).toBe(unicodeText)
      }
    })

    test("should handle special JSON characters", () => {
      const specialChars = `"quotes", 'apostrophes', \n newlines, \t tabs, \\ backslashes, / slashes`

      const payload: AnthropicMessagesPayload = {
        model: "claude-3-5-sonnet-20241022",
        messages: [
          {
            role: "user",
            content: specialChars,
          },
        ],
        max_tokens: 100,
      }

      const result = parseAnthropicMessages(payload)
      expect(result.messages[0].content[0].text).toBe(specialChars)
    })
  })

  describe("Memory and Performance", () => {
    test("should not leak memory with repeated conversions", () => {
      const basePayload: AnthropicMessagesPayload = {
        model: "claude-3-5-sonnet-20241022",
        messages: [
          {
            role: "user",
            content: "test message",
          },
        ],
        max_tokens: 100,
      }

      // Run many conversions to test for memory leaks
      for (let i = 0; i < 1000; i++) {
        const result = parseAnthropicMessages(basePayload)
        expect(result.messages).toHaveLength(1)

        // Convert back
        const backConverted = canonicalRequestToChatCompletionsPayload(result)
        expect(backConverted.messages).toHaveLength(1)
      }

      // If we get here without running out of memory, the test passes
      expect(true).toBe(true)
    })

    test("should handle concurrent conversions", async () => {
      const basePayload: AnthropicMessagesPayload = {
        model: "claude-3-5-sonnet-20241022",
        messages: [
          {
            role: "user",
            content: "concurrent test",
          },
        ],
        max_tokens: 100,
      }

      // Run multiple conversions concurrently
      const promises = Array.from({ length: 100 }, async (_, i) => {
        const payload = {
          ...basePayload,
          messages: [
            {
              role: "user" as const,
              content: `concurrent test ${i}`,
            },
          ],
        }

        const result = parseAnthropicMessages(payload)
        expect(result.messages[0].content[0].text).toBe(`concurrent test ${i}`)
        return result
      })

      const results = await Promise.all(promises)
      expect(results).toHaveLength(100)
    })
  })
})
