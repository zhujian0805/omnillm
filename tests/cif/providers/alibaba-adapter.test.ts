import { beforeEach, describe, expect, jest, test } from "bun:test"

import type { CanonicalRequest } from "~/cif/types"
import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import { AlibabaAdapter } from "~/providers/alibaba/adapter"
import { AlibabaProvider } from "~/providers/alibaba/handlers"

const mockProvider = {
  createChatCompletions: jest.fn(),
} as unknown as AlibabaProvider

describe("AlibabaAdapter", () => {
  const adapter = new AlibabaAdapter(mockProvider)

  beforeEach(() => {
    ;(
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mockClear()
  })

  test("should execute qwen3.6-plus requests", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "qwen3.6-plus",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Reply with pong" }],
        },
      ],
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-ali-123",
      object: "chat.completion",
      created: 1_677_652_288,
      model: "qwen3.6-plus",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "pong",
          },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      },
    }

    ;(
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "content-type": "application/json" },
      }),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(result.id).toBe("chatcmpl-ali-123")
    expect(result.model).toBe("qwen3.6-plus")
    expect(result.stopReason).toBe("end_turn")
    expect(result.content).toEqual([{ type: "text", text: "pong" }])

    const providerCall = (
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>
      model: string
    }

    expect(providerCall.model).toBe("qwen3.6-plus")
    expect(providerCall.messages[0]?.content).toBe("Reply with pong")
  })

  test("should prefer qwen3.6-plus for Claude Sonnet compatibility", () => {
    expect(adapter.remapModel("claude-sonnet-4.5")).toBe("qwen3.6-plus")
    expect(adapter.remapModel("claude-sonnet-4-5-20250929")).toBe(
      "qwen3.6-plus",
    )
  })

  test("should pass through non-Claude model names unchanged", () => {
    expect(adapter.remapModel("qwen3.6-plus")).toBe("qwen3.6-plus")
    expect(adapter.remapModel("qwen-max")).toBe("qwen-max")
    expect(adapter.remapModel("gpt-5-mini")).toBe("gpt-5-mini")
  })

  test("should handle tool calls for qwen3.6-plus", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "qwen3.6-plus",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Check the weather in Tokyo" }],
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
      id: "chatcmpl-ali-tool",
      object: "chat.completion",
      created: 1_677_652_288,
      model: "qwen3.6-plus",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_ali_1",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: JSON.stringify({ location: "Tokyo" }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
          logprobs: null,
        },
      ],
    }

    ;(
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "content-type": "application/json" },
      }),
    )

    const result = await adapter.execute(canonicalRequest)

    expect(result.stopReason).toBe("tool_use")
    expect(result.content).toEqual([
      {
        type: "tool_call",
        toolCallId: "call_ali_1",
        toolName: "get_weather",
        toolArguments: { location: "Tokyo" },
      },
    ])
  })

  test("should stream qwen3.6-plus responses via chat completions", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "qwen3.6-plus",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "ping" }],
        },
      ],
      stream: true,
    }

    const encoder = new TextEncoder()
    const chunks = [
      'data: {"id":"chatcmpl-ali-stream","object":"chat.completion.chunk","created":1677652288,"model":"qwen3.6-plus","choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-ali-stream","object":"chat.completion.chunk","created":1677652288,"model":"qwen3.6-plus","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1,"total_tokens":5}}\n\n',
      "data: [DONE]\n\n",
    ]

    ;(
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(chunk))
            }
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    )

    const events = []
    for await (const event of adapter.executeStream(canonicalRequest)) {
      events.push(event)
    }

    expect(events[0]).toEqual({
      type: "stream_start",
      id: "chatcmpl-ali-stream",
      model: "qwen3.6-plus",
    })
    expect(events[1]).toEqual({
      type: "content_delta",
      index: 0,
      contentBlock: { type: "text", text: "" },
      delta: { type: "text_delta", text: "pong" },
    })
    expect(events[2]).toEqual({
      type: "stream_end",
      stopReason: "end_turn",
      stopSequence: null,
      usage: { inputTokens: 4, outputTokens: 1 },
    })
  })

  test("should stream tool calls for qwen3.6-plus", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "qwen3.6-plus",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Check weather in Shanghai" }],
        },
      ],
      stream: true,
    }

    const encoder = new TextEncoder()
    const chunks = [
      String.raw`data: {"id":"chatcmpl-ali-tool-stream","object":"chat.completion.chunk","created":1677652288,"model":"qwen3.6-plus","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}`,
      "\n\n",
      String.raw`data: {"id":"chatcmpl-ali-tool-stream","object":"chat.completion.chunk","created":1677652288,"model":"qwen3.6-plus","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"location\":\"Shanghai\"}"}}]},"finish_reason":null}]}`,
      "\n\n",
      'data: {"id":"chatcmpl-ali-tool-stream","object":"chat.completion.chunk","created":1677652288,"model":"qwen3.6-plus","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":15,"completion_tokens":8,"total_tokens":23}}\n\n',
      "data: [DONE]\n\n",
    ]

    ;(
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(chunk))
            }
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    )

    const events = []
    for await (const event of adapter.executeStream(canonicalRequest)) {
      events.push(event)
    }

    expect(events[0]).toEqual({
      type: "stream_start",
      id: "chatcmpl-ali-tool-stream",
      model: "qwen3.6-plus",
    })
    const toolCallEvent = events.find(
      (e) =>
        e.type === "content_delta"
        && e.contentBlock?.type === "tool_call",
    )
    expect(toolCallEvent).toBeDefined()
    expect(toolCallEvent?.contentBlock?.toolName).toBe("get_weather")
    const endEvent = events.at(-1)
    expect(endEvent?.type).toBe("stream_end")
    expect(endEvent?.stopReason).toBe("tool_use")
  })
})
