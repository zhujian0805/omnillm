import { beforeEach, describe, test, expect, jest } from "bun:test"

import type { CanonicalRequest } from "~/cif/types"
import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import { parseResponsesPayload } from "~/ingestion/from-responses"
import { AzureOpenAIAdapter } from "~/providers/azure-openai/adapter"
import { AzureOpenAIProvider } from "~/providers/azure-openai/handlers"
import { responsesResponseToChatCompletions } from "~/routes/responses/translation"

// Mock the provider
const mockProvider = {
  createChatCompletions: jest.fn(),
  createResponses: jest.fn(),
} as unknown as AzureOpenAIProvider

describe("AzureOpenAIAdapter", () => {
  const adapter = new AzureOpenAIAdapter(mockProvider)

  beforeEach(() => {
    ;(mockProvider.createChatCompletions as any).mockReset()
    ;(mockProvider.createResponses as any).mockReset()
  })

  test("should execute simple text request", async () => {
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

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello! How can I help you today?",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 12,
        total_tokens: 21,
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "content-type": "application/json" },
      }),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(result.id).toBe("chatcmpl-123")
    expect(result.model).toBe("gpt-4")
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Hello! How can I help you today?")
    expect(result.stopReason).toBe("end_turn")
    expect(result.usage?.inputTokens).toBe(9)
    expect(result.usage?.outputTokens).toBe(12)
  })

  test("should execute request with tool calls", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
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
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-456",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
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
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "content-type": "application/json" },
      }),
    )

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
  })

  test("should handle max_tokens finish reason", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Tell me a long story" }],
        },
      ],
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-789",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Once upon a time, in a land far away...",
          },
          finish_reason: "length",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 100,
        total_tokens: 110,
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "content-type": "application/json" },
      }),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(result.stopReason).toBe("max_tokens")
  })

  test("should handle content_filter finish reason", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Inappropriate content" }],
        },
      ],
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-filtered",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "I can't help with that request.",
          },
          finish_reason: "content_filter",
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 8,
        total_tokens: 13,
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "content-type": "application/json" },
      }),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(result.stopReason).toBe("content_filter")
  })

  test("should handle multiple choices by merging content", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Generate multiple responses" }],
        },
      ],
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-multi",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Response 1",
          },
          finish_reason: "stop",
        },
        {
          index: 1,
          message: {
            role: "assistant",
            content: "Response 2",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 10,
        total_tokens: 15,
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "content-type": "application/json" },
      }),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(result.content).toHaveLength(2)
    expect(result.content[0].type).toBe("text")
    expect(result.content[0].text).toBe("Response 1")
    expect(result.content[1].type).toBe("text")
    expect(result.content[1].text).toBe("Response 2")
  })

  test("should handle null content with tool calls", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Use a tool" }],
        },
      ],
      tools: [
        {
          name: "test_tool",
          parametersSchema: { type: "object" },
        },
      ],
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-null-content",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: {
                  name: "test_tool",
                  arguments: "{}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 10,
        total_tokens: 15,
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "content-type": "application/json" },
      }),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("tool_call")
  })

  test("should handle cached tokens in usage", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-cached",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hi there!",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 10,
        total_tokens: 60,
        prompt_tokens_details: {
          cached_tokens: 30,
        },
      },
    }

    ;(mockProvider.createChatCompletions as any).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "content-type": "application/json" },
      }),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(result.usage?.inputTokens).toBe(20) // 50 - 30 cached
    expect(result.usage?.outputTokens).toBe(10)
    expect(result.usage?.cacheReadInputTokens).toBe(30)
  })

  test("should extract assistant text from later responses output items", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.4-pro",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Reply with exactly PONG." }],
        },
      ],
      maxTokens: 64,
      stream: false,
    }

    ;(mockProvider.createResponses as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          model: "gpt-5.4-pro",
          status: "completed",
          output: [
            {
              id: "rs_1",
              type: "reasoning",
              status: "completed",
            },
            {
              id: "msg_1",
              type: "message",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: "PONG",
                },
              ],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 1,
          },
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(mockProvider.createResponses).toHaveBeenCalledTimes(1)
    expect(mockProvider.createChatCompletions).not.toHaveBeenCalled()
    expect(result.content).toEqual([{ type: "text", text: "PONG" }])
    expect(result.stopReason).toBe("end_turn")
    expect(result.usage?.inputTokens).toBe(12)
    expect(result.usage?.outputTokens).toBe(1)
  })

  test("should preserve tools and tool choice in responses payload", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.3-codex",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Check the weather" }],
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
      toolChoice: { type: "function", functionName: "get_weather" },
      stream: false,
    }

    ;(mockProvider.createResponses as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_tools",
          model: "gpt-5.3-codex",
          status: "completed",
          output: [
            {
              id: "msg_1",
              type: "message",
              status: "completed",
              content: [{ type: "output_text", text: "done" }],
            },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    )

    await adapter.execute(canonicalRequest)

    const payload = (mockProvider.createResponses as any).mock.calls[0][0]
    expect(payload.tools).toEqual([
      {
        type: "function",
        name: "get_weather",
        description: "Get current weather",
        parameters: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        },
      },
    ])
    expect(payload.tool_choice).toEqual("auto")
  })

  test("should preserve assistant tool calls and tool results in responses payload", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.3-codex",
      messages: [
        {
          role: "system",
          content: "You are a helpful weather assistant.",
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Calling tool" },
            {
              type: "tool_call",
              toolCallId: "call_1",
              toolName: "get_weather",
              toolArguments: { location: "SF" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: "call_1",
              toolName: "get_weather",
              content: '{"temperature":72}',
            },
          ],
        },
      ],
      stream: false,
    }

    ;(mockProvider.createResponses as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_history",
          model: "gpt-5.3-codex",
          status: "completed",
          output: [
            {
              id: "msg_1",
              type: "message",
              status: "completed",
              content: [{ type: "output_text", text: "done" }],
            },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    )

    await adapter.execute(canonicalRequest)

    const payload = (mockProvider.createResponses as any).mock.calls[0][0]
    expect(payload.input).toEqual([
      {
        type: "message",
        role: "system",
        content: [
          {
            text: "You are a helpful weather assistant.",
            type: "input_text",
          },
        ],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Calling tool" }],
      },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "fc_1",
        name: "get_weather",
        arguments: '{"location":"SF"}',
      },
      {
        type: "function_call_output",
        call_id: "fc_1",
        output: '{"temperature":72}',
      },
    ])
  })

  test("should normalize structured tool result content before sending to responses API", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.3-codex",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: "call_1",
              toolName: "get_weather",
              content: [
                { type: "text", text: '{"temperature":72}' },
                { type: "text", text: "Clear skies" },
              ] as unknown as string,
            },
          ],
        },
      ],
      stream: false,
    }

    ;(mockProvider.createResponses as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_tool_result_blocks",
          model: "gpt-5.3-codex",
          status: "completed",
          output: [
            {
              id: "msg_1",
              type: "message",
              status: "completed",
              content: [{ type: "output_text", text: "done" }],
            },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    )

    await adapter.execute(canonicalRequest)

    const payload = (mockProvider.createResponses as any).mock.calls[0][0]
    expect(payload.input).toEqual([
      {
        type: "function_call_output",
        call_id: "fc_1",
        output: '{"temperature":72}\n\nClear skies',
      },
    ])
  })

  test("should fall back to empty object string for unserializable tool arguments", async () => {
    const toolArguments = Object.create(null) as Record<string, unknown>
    toolArguments.location = "SF"
    toolArguments.toJSON = () => undefined

    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.3-codex",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              toolCallId: "call_1",
              toolName: "get_weather",
              toolArguments,
            },
          ],
        },
      ],
      stream: false,
    }

    ;(mockProvider.createResponses as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_unserializable",
          model: "gpt-5.3-codex",
          status: "completed",
          output: [
            {
              id: "msg_1",
              type: "message",
              status: "completed",
              content: [{ type: "output_text", text: "done" }],
            },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    )

    await adapter.execute(canonicalRequest)

    const payload = (mockProvider.createResponses as any).mock.calls[0][0]
    expect(payload.input).toEqual([
      {
        type: "function_call",
        id: "fc_1",
        call_id: "fc_1",
        name: "get_weather",
        arguments: "{}",
      },
    ])
  })

  test("should reject function calls without call_id or id during responses ingestion", () => {
    expect(() =>
      parseResponsesPayload({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "function_call",
            name: "get_weather",
            arguments: '{"location":"SF"}',
          },
        ],
      }),
    ).toThrow("Responses function_call item missing call_id and id")
  })

  test("should preserve function calls from responses output", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.3-codex",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Use the weather tool" }],
        },
      ],
      stream: false,
    }

    ;(mockProvider.createResponses as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_function",
          model: "gpt-5.3-codex",
          status: "completed",
          output: [
            {
              id: "msg_1",
              type: "message",
              status: "completed",
              content: [{ type: "output_text", text: "Let me check." }],
            },
            {
              id: "call_2",
              type: "function_call",
              name: "get_weather",
              arguments: '{"location":"SF"}',
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(result.content).toEqual([
      { type: "text", text: "Let me check." },
      {
        type: "tool_call",
        toolCallId: "call_2",
        toolName: "get_weather",
        toolArguments: { location: "SF" },
      },
    ])
    expect(result.stopReason).toBe("tool_use")
  })

  test("should convert tool-call-only responses to chat completions with null content", () => {
    const json = responsesResponseToChatCompletions({
      id: "resp_tool_only",
      object: "realtime.response",
      model: "gpt-5.3-codex",
      output: [
        {
          id: "call_2",
          type: "function_call",
          role: "assistant",
          name: "get_weather",
          arguments: '{"location":"SF"}',
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    })

    expect(json.choices[0].message).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_2",
          type: "function",
          function: {
            name: "get_weather",
            arguments: '{"location":"SF"}',
          },
        },
      ],
    })
    expect(json.choices[0].finish_reason).toBe("tool_calls")
  })

  test("should use responses API for streaming GPT-5.4 requests with flat tools", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Check the weather." }],
        },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get current weather",
          parametersSchema: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      ],
      stream: true,
    }

    ;(mockProvider.createResponses as any).mockResolvedValue(
      new Response(
        [
          "data: "
            + JSON.stringify({
              id: "chatcmpl_stream_1",
              object: "chat.completion.chunk",
              created: 1775551783,
              model: "gpt-5.4",
              choices: [
                {
                  index: 0,
                  delta: { content: "Sunny" },
                  finish_reason: null,
                },
              ],
            }),
          "",
          "data: "
            + JSON.stringify({
              id: "chatcmpl_stream_1",
              object: "chat.completion.chunk",
              created: 1775551783,
              model: "gpt-5.4",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            }),
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
        {
          headers: { "content-type": "text/event-stream" },
        },
      ),
    )

    const events = []
    for await (const event of adapter.executeStream(canonicalRequest)) {
      events.push(event)
    }

    expect(mockProvider.createResponses).toHaveBeenCalledTimes(1)
    expect(mockProvider.createChatCompletions).not.toHaveBeenCalled()

    const payload = (mockProvider.createResponses as any).mock.calls[0][0]
    expect(payload.stream).toBe(true)
    expect(payload.tools).toEqual([
      {
        type: "function",
        name: "get_weather",
        description: "Get current weather",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" },
          },
          required: ["location"],
        },
      },
    ])
    expect(events.some((event) => event.type === "content_delta")).toBe(true)
    expect(events.some((event) => event.type === "stream_end")).toBe(true)
  })

  test("should parse streaming GPT-5.4 chunks split across SSE boundaries", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Say hello." }],
        },
      ],
      stream: true,
    }

    const encoder = new TextEncoder()
    const chunks = [
      'data: {"id":"chatcmpl-split","object":"chat.completion.chunk","created":1677652288,"model":"gpt-5.4","choices":[{"index":0,"delta":{"content":"Hel',
      'lo"},"finish_reason":null,"logprobs":null}]}\n\n',
      'data: {"id":"chatcmpl-split","object":"chat.completion.chunk","created":1677652288,"model":"gpt-5.4","choices":[{"index":0,"delta":{},"finish_reason":"stop","logprobs":null}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n\n',
      "data: [DONE]\n\n",
    ]

    ;(mockProvider.createResponses as any).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(chunk))
            }
            controller.close()
          },
        }),
        {
          headers: { "content-type": "text/event-stream" },
        },
      ),
    )

    const events = []
    for await (const event of adapter.executeStream(canonicalRequest)) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        type: "stream_start",
        id: "chatcmpl-split",
        model: "gpt-5.4",
      },
      {
        type: "content_delta",
        index: 0,
        contentBlock: { type: "text", text: "" },
        delta: {
          type: "text_delta",
          text: "Hello",
        },
      },
      {
        type: "stream_end",
        stopReason: "end_turn",
        stopSequence: null,
        usage: {
          inputTokens: 3,
          outputTokens: 1,
        },
      },
    ])
  })

  test("should pass through model name unchanged", () => {
    expect(adapter.remapModel?.("gpt-4")).toBe("gpt-4")
    expect(adapter.remapModel?.("gpt-3.5-turbo")).toBe("gpt-3.5-turbo")
    expect(adapter.remapModel?.("custom-model")).toBe("custom-model")
  })
})
