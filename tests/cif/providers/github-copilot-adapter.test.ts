import { beforeEach, describe, expect, jest, test } from "bun:test"

import type { CanonicalRequest } from "~/cif/types"
import type { ChatCompletionResponse } from "~/services/copilot/create-chat-completions"

import { GitHubCopilotAdapter } from "~/providers/github-copilot/adapter"
import { GitHubCopilotProvider } from "~/providers/github-copilot/handlers"

const mockProvider = {
  createChatCompletions: jest.fn(),
} as unknown as GitHubCopilotProvider

describe("GitHubCopilotAdapter", () => {
  const adapter = new GitHubCopilotAdapter(mockProvider)

  beforeEach(() => {
    ;(
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mockClear()
  })

  test("should execute Claude Haiku 4.5 requests", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "claude-haiku-4.5",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Reply with pong" }],
        },
      ],
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-gh-123",
      object: "chat.completion",
      created: 1_677_652_288,
      model: "claude-haiku-4.5",
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
        prompt_tokens: 8,
        completion_tokens: 2,
        total_tokens: 10,
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

    expect(result.id).toBe("chatcmpl-gh-123")
    expect(result.model).toBe("claude-haiku-4.5")
    expect(result.stopReason).toBe("end_turn")
    expect(result.content).toEqual([{ type: "text", text: "pong" }])

    const providerCall = (
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>
      model: string
    }

    expect(providerCall.model).toBe("claude-haiku-4.5")
    expect(providerCall.messages[0]?.content).toBe("Reply with pong")
  })

  test("should preserve tool calls for Claude Haiku 4.5", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "claude-haiku-4.5",
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
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-gh-tool",
      object: "chat.completion",
      created: 1_677_652_288,
      model: "claude-haiku-4.5",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Let me check.",
            tool_calls: [
              {
                id: "call_123",
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
      { type: "text", text: "Let me check." },
      {
        type: "tool_call",
        toolArguments: { location: "Tokyo" },
        toolCallId: "call_123",
        toolName: "get_weather",
      },
    ])
  })

  test("should normalize Claude Haiku aliases to Claude Haiku 4.5", () => {
    expect(adapter.remapModel("claude-haiku-4.5")).toBe("claude-haiku-4.5")
    expect(adapter.remapModel("claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4.5",
    )
  })

  test("should execute gpt-5.4 requests via chat completions", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.4",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "What is 2+2?" }],
        },
      ],
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-gpt54-123",
      object: "chat.completion",
      created: 1_677_652_288,
      model: "gpt-5.4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "4",
          },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 1,
        total_tokens: 11,
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

    expect(result.id).toBe("chatcmpl-gpt54-123")
    expect(result.model).toBe("gpt-5.4")
    expect(result.stopReason).toBe("end_turn")
    expect(result.content).toEqual([{ type: "text", text: "4" }])
    expect(result.usage?.inputTokens).toBe(10)
    expect(result.usage?.outputTokens).toBe(1)

    // GitHub Copilot always uses createChatCompletions, never createResponses
    expect(
      (mockProvider.createChatCompletions as ReturnType<typeof jest.fn>).mock
        .calls,
    ).toHaveLength(1)
    const providerCall = (
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mock.calls[0]?.[0] as { model: string }
    expect(providerCall.model).toBe("gpt-5.4")
  })

  test("should execute gpt-5-mini requests via chat completions", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5-mini",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Reply with pong" }],
        },
      ],
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-gpt5mini-456",
      object: "chat.completion",
      created: 1_677_652_288,
      model: "gpt-5-mini",
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
        prompt_tokens: 8,
        completion_tokens: 2,
        total_tokens: 10,
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

    expect(result.id).toBe("chatcmpl-gpt5mini-456")
    expect(result.model).toBe("gpt-5-mini")
    expect(result.stopReason).toBe("end_turn")
    expect(result.content).toEqual([{ type: "text", text: "pong" }])

    const providerCall = (
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mock.calls[0]?.[0] as { model: string }
    expect(providerCall.model).toBe("gpt-5-mini")
  })

  test("should pass through gpt-5.4 and gpt-5-mini model names unchanged", () => {
    expect(adapter.remapModel("gpt-5.4")).toBe("gpt-5.4")
    expect(adapter.remapModel("gpt-5-mini")).toBe("gpt-5-mini")
    expect(adapter.remapModel("gpt-5.4-mini")).toBe("gpt-5.4-mini")
  })

  test("should stream gpt-5.4 responses via chat completions", async () => {
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
      'data: {"id":"chatcmpl-gpt54-stream","object":"chat.completion.chunk","created":1677652288,"model":"gpt-5.4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null,"logprobs":null}]}',
      "\n\n",
      'data: {"id":"chatcmpl-gpt54-stream","object":"chat.completion.chunk","created":1677652288,"model":"gpt-5.4","choices":[{"index":0,"delta":{},"finish_reason":"stop","logprobs":null}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}',
      "\n\n",
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

    expect(events).toEqual([
      { type: "stream_start", id: "chatcmpl-gpt54-stream", model: "gpt-5.4" },
      {
        type: "content_delta",
        index: 0,
        contentBlock: { type: "text", text: "" },
        delta: { type: "text_delta", text: "Hello" },
      },
      {
        type: "stream_end",
        stopReason: "end_turn",
        stopSequence: null,
        usage: { inputTokens: 5, outputTokens: 1 },
      },
    ])
  })

  test("should stream gpt-5-mini responses via chat completions", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5-mini",
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
      'data: {"id":"chatcmpl-mini-stream","object":"chat.completion.chunk","created":1677652288,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":null,"logprobs":null}]}',
      "\n\n",
      'data: {"id":"chatcmpl-mini-stream","object":"chat.completion.chunk","created":1677652288,"model":"gpt-5-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop","logprobs":null}]}',
      "\n\n",
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
      id: "chatcmpl-mini-stream",
      model: "gpt-5-mini",
    })
    expect(events.some((e) => e.type === "content_delta")).toBe(true)
    expect(events.at(-1)?.type).toBe("stream_end")
  })

  test("should handle tool calls for gpt-5.4", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "gpt-5.4",
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
      stream: false,
    }

    const mockResponse: ChatCompletionResponse = {
      id: "chatcmpl-gpt54-tool",
      object: "chat.completion",
      created: 1_677_652_288,
      model: "gpt-5.4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc",
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
        toolCallId: "call_abc",
        toolName: "get_weather",
        toolArguments: { location: "Tokyo" },
      },
    ])
  })

  test("should parse streamed tool calls when SSE lines span multiple chunks", async () => {
    const canonicalRequest: CanonicalRequest = {
      model: "claude-sonnet-4.6",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Inspect the repo" }],
        },
      ],
      stream: true,
    }

    const encoder = new TextEncoder()
    const chunks = [
      'data: {"id":"chatcmpl-gh-stream","object":"chat.completion.chunk","created":1677652288,"model":"claude-sonnet-4.6","choices":[{"index":0,"delta":{"content":"Let me explore the codebase."},"finish_reason":null,"logprobs":null}]}',
      "\n\n",
      String.raw`data: {"id":"chatcmpl-gh-stream","object":"chat.completion.chunk","created":1677652288,"model":"claude-sonnet-4.6","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"shell_command","arguments":"{\"command\":\"rg --files\"}"}}]},"finish_reason":null,"logprobs":null}]}`,
      "\n\n",
      'data: {"id":"chatcmpl-gh-stream","object":"chat.completion.chunk","created":1677652288,"model":"claude-sonnet-4.6","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls","logprobs":null}],"usage":{"prompt_tokens":20,"completion_tokens":8,"total_tokens":28}}',
      "\n\n",
      "data: [DONE]\n\n",
    ]

    const response = new Response(
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
    )

    ;(
      mockProvider.createChatCompletions as ReturnType<typeof jest.fn>
    ).mockResolvedValue(response)

    const events = []
    for await (const event of adapter.executeStream(canonicalRequest)) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        type: "stream_start",
        id: "chatcmpl-gh-stream",
        model: "claude-sonnet-4.6",
      },
      {
        type: "content_delta",
        index: 0,
        contentBlock: { type: "text", text: "" },
        delta: {
          type: "text_delta",
          text: "Let me explore the codebase.",
        },
      },
      {
        type: "content_delta",
        index: 0,
        contentBlock: {
          type: "tool_call",
          toolCallId: "call_123",
          toolName: "shell_command",
          toolArguments: {},
        },
        delta: {
          type: "tool_arguments_delta",
          partialJson: '{"command":"rg --files"}',
        },
      },
      {
        type: "stream_end",
        stopReason: "tool_use",
        stopSequence: null,
        usage: {
          inputTokens: 20,
          outputTokens: 8,
        },
      },
    ])
  })
})
