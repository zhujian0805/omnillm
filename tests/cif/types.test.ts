import { describe, test, expect } from "bun:test"

import type {
  CanonicalRequest,
  CanonicalResponse,
  CIFMessage,
  CIFContentPart,
  CIFStreamEvent,
  CIFTool,
  CIFToolChoice,
} from "~/cif/types"

describe("CIF Types Validation", () => {
  describe("CIFContentPart Types", () => {
    test("should validate text content part", () => {
      const textPart: CIFContentPart = {
        type: "text",
        text: "Hello world",
      }

      expect(textPart.type).toBe("text")
      expect(textPart.text).toBe("Hello world")
    })

    test("should validate thinking content part", () => {
      const thinkingPart: CIFContentPart = {
        type: "thinking",
        thinking: "Let me think about this...",
        signature: "thinking_signature_123",
      }

      expect(thinkingPart.type).toBe("thinking")
      expect(thinkingPart.thinking).toBe("Let me think about this...")
      expect(thinkingPart.signature).toBe("thinking_signature_123")
    })

    test("should validate image content part with base64 data", () => {
      const imagePart: CIFContentPart = {
        type: "image",
        mediaType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      }

      expect(imagePart.type).toBe("image")
      expect(imagePart.mediaType).toBe("image/png")
      expect(imagePart.data).toMatch(/^[A-Z0-9+/=]+$/i)
    })

    test("should validate image content part with URL", () => {
      const imagePart: CIFContentPart = {
        type: "image",
        mediaType: "image/jpeg",
        url: "https://example.com/image.jpg",
      }

      expect(imagePart.type).toBe("image")
      expect(imagePart.mediaType).toBe("image/jpeg")
      expect(imagePart.url).toBe("https://example.com/image.jpg")
    })

    test("should validate tool call content part", () => {
      const toolCallPart: CIFContentPart = {
        type: "tool_call",
        toolCallId: "call_123",
        toolName: "get_weather",
        toolArguments: { location: "San Francisco" },
      }

      expect(toolCallPart.type).toBe("tool_call")
      expect(toolCallPart.toolCallId).toBe("call_123")
      expect(toolCallPart.toolName).toBe("get_weather")
      expect(toolCallPart.toolArguments).toEqual({ location: "San Francisco" })
    })

    test("should validate tool result content part", () => {
      const toolResultPart: CIFContentPart = {
        type: "tool_result",
        toolCallId: "call_123",
        toolName: "get_weather",
        content: "Sunny, 72°F",
        isError: false,
      }

      expect(toolResultPart.type).toBe("tool_result")
      expect(toolResultPart.toolCallId).toBe("call_123")
      expect(toolResultPart.toolName).toBe("get_weather")
      expect(toolResultPart.content).toBe("Sunny, 72°F")
      expect(toolResultPart.isError).toBe(false)
    })

    test("should validate tool result error", () => {
      const errorResult: CIFContentPart = {
        type: "tool_result",
        toolCallId: "call_456",
        toolName: "broken_tool",
        content: "Tool execution failed",
        isError: true,
      }

      expect(errorResult.isError).toBe(true)
      expect(errorResult.content).toBe("Tool execution failed")
    })
  })

  describe("CIFMessage Types", () => {
    test("should validate system message", () => {
      const systemMsg: CIFMessage = {
        role: "system",
        content: "You are a helpful assistant.",
      }

      expect(systemMsg.role).toBe("system")
      expect(systemMsg.content).toBe("You are a helpful assistant.")
    })

    test("should validate user message with mixed content", () => {
      const userMsg: CIFMessage = {
        role: "user",
        content: [
          { type: "text", text: "What's the weather like in this image?" },
          {
            type: "image",
            mediaType: "image/png",
            data: "base64data...",
          },
          {
            type: "tool_result",
            toolCallId: "call_123",
            toolName: "get_weather",
            content: "Sunny, 72°F",
          },
        ],
      }

      expect(userMsg.role).toBe("user")
      expect(Array.isArray(userMsg.content)).toBe(true)
      expect(userMsg.content).toHaveLength(3)
      expect(userMsg.content[0].type).toBe("text")
      expect(userMsg.content[1].type).toBe("image")
      expect(userMsg.content[2].type).toBe("tool_result")
    })

    test("should validate assistant message with thinking and tool calls", () => {
      const assistantMsg: CIFMessage = {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "I need to check the weather..." },
          { type: "text", text: "Let me check the weather for you." },
          {
            type: "tool_call",
            toolCallId: "call_456",
            toolName: "get_weather",
            toolArguments: { location: "San Francisco" },
          },
        ],
      }

      expect(assistantMsg.role).toBe("assistant")
      expect(assistantMsg.content).toHaveLength(3)
      expect(assistantMsg.content[0].type).toBe("thinking")
      expect(assistantMsg.content[1].type).toBe("text")
      expect(assistantMsg.content[2].type).toBe("tool_call")
    })
  })

  describe("CIFTool Types", () => {
    test("should validate tool definition", () => {
      const tool: CIFTool = {
        name: "get_weather",
        description: "Get current weather for a location",
        parametersSchema: {
          type: "object",
          properties: {
            location: { type: "string" },
            units: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["location"],
        },
      }

      expect(tool.name).toBe("get_weather")
      expect(tool.description).toBe("Get current weather for a location")
      expect(tool.parametersSchema).toBeDefined()
      expect(tool.parametersSchema.properties).toBeDefined()
    })

    test("should validate tool choice types", () => {
      const autoChoice: CIFToolChoice = "auto"
      const noneChoice: CIFToolChoice = "none"
      const requiredChoice: CIFToolChoice = "required"
      const specificChoice: CIFToolChoice = {
        type: "function",
        functionName: "get_weather",
      }

      expect(autoChoice).toBe("auto")
      expect(noneChoice).toBe("none")
      expect(requiredChoice).toBe("required")
      expect(specificChoice.type).toBe("function")
      expect(specificChoice.functionName).toBe("get_weather")
    })
  })

  describe("CanonicalRequest", () => {
    test("should validate complete canonical request", () => {
      const request: CanonicalRequest = {
        model: "claude-3-5-sonnet-20241022",
        systemPrompt: "You are a helpful assistant.",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello" }],
          },
        ],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            parametersSchema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
        toolChoice: "auto",
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 1000,
        stop: ["STOP"],
        stream: false,
        userId: "user123",
        extensions: {
          thinkingBudgetTokens: 1000,
          requiresDummyToolInjection: true,
        },
      }

      expect(request.model).toBe("claude-3-5-sonnet-20241022")
      expect(request.systemPrompt).toBe("You are a helpful assistant.")
      expect(request.messages).toHaveLength(1)
      expect(request.tools).toHaveLength(1)
      expect(request.toolChoice).toBe("auto")
      expect(request.temperature).toBe(0.7)
      expect(request.topP).toBe(0.9)
      expect(request.maxTokens).toBe(1000)
      expect(request.stop).toEqual(["STOP"])
      expect(request.stream).toBe(false)
      expect(request.userId).toBe("user123")
      expect(request.extensions?.thinkingBudgetTokens).toBe(1000)
      expect(request.extensions?.requiresDummyToolInjection).toBe(true)
    })

    test("should validate minimal canonical request", () => {
      const request: CanonicalRequest = {
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello" }],
          },
        ],
        stream: false,
      }

      expect(request.model).toBe("gpt-4")
      expect(request.messages).toHaveLength(1)
      expect(request.stream).toBe(false)
      expect(request.systemPrompt).toBeUndefined()
      expect(request.tools).toBeUndefined()
      expect(request.temperature).toBeUndefined()
    })
  })

  describe("CanonicalResponse", () => {
    test("should validate complete canonical response", () => {
      const response: CanonicalResponse = {
        id: "response_123",
        model: "claude-3-5-sonnet-20241022",
        content: [
          { type: "thinking", thinking: "Let me think..." },
          { type: "text", text: "The answer is 42." },
          {
            type: "tool_call",
            toolCallId: "call_789",
            toolName: "calculate",
            toolArguments: { expression: "6 * 7" },
          },
        ],
        stopReason: "tool_use",
        stopSequence: null,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 20,
          cacheWriteInputTokens: 10,
        },
      }

      expect(response.id).toBe("response_123")
      expect(response.model).toBe("claude-3-5-sonnet-20241022")
      expect(response.content).toHaveLength(3)
      expect(response.stopReason).toBe("tool_use")
      expect(response.usage?.inputTokens).toBe(100)
      expect(response.usage?.outputTokens).toBe(50)
      expect(response.usage?.cacheReadInputTokens).toBe(20)
    })

    test("should validate all stop reasons", () => {
      const stopReasons = [
        "end_turn",
        "max_tokens",
        "tool_use",
        "stop_sequence",
        "content_filter",
        "error",
      ] as const

      for (const reason of stopReasons) {
        const response: CanonicalResponse = {
          id: "test",
          model: "test",
          content: [],
          stopReason: reason,
        }
        expect(response.stopReason).toBe(reason)
      }
    })
  })

  describe("CIFStreamEvent Types", () => {
    test("should validate stream start event", () => {
      const startEvent: CIFStreamEvent = {
        type: "stream_start",
        id: "stream_123",
        model: "claude-3-5-sonnet-20241022",
      }

      expect(startEvent.type).toBe("stream_start")
      expect(startEvent.id).toBe("stream_123")
      expect(startEvent.model).toBe("claude-3-5-sonnet-20241022")
    })

    test("should validate content delta event", () => {
      const deltaEvent: CIFStreamEvent = {
        type: "content_delta",
        index: 0,
        contentBlock: { type: "text", text: "" },
        delta: { type: "text_delta", text: "Hello" },
      }

      expect(deltaEvent.type).toBe("content_delta")
      expect(deltaEvent.index).toBe(0)
      expect(deltaEvent.contentBlock?.type).toBe("text")
      expect(deltaEvent.delta.type).toBe("text_delta")
    })

    test("should validate stream end event", () => {
      const endEvent: CIFStreamEvent = {
        type: "stream_end",
        stopReason: "end_turn",
        stopSequence: null,
        usage: {
          inputTokens: 50,
          outputTokens: 100,
        },
      }

      expect(endEvent.type).toBe("stream_end")
      expect(endEvent.stopReason).toBe("end_turn")
      expect(endEvent.usage?.inputTokens).toBe(50)
      expect(endEvent.usage?.outputTokens).toBe(100)
    })

    test("should validate content block stop event", () => {
      const stopEvent: CIFStreamEvent = {
        type: "content_block_stop",
        index: 0,
      }

      expect(stopEvent.type).toBe("content_block_stop")
      expect(stopEvent.index).toBe(0)
    })
  })
})
