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
})
