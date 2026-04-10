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
