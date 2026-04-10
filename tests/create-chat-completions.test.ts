import { afterAll, beforeEach, expect, mock, test } from "bun:test"

import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
} from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import {
  createChatCompletions,
  normalizeChatCompletionResponse,
} from "../src/services/copilot/create-chat-completions"

const originalFetch = globalThis.fetch
const originalState = {
  accountType: state.accountType,
  copilotToken: state.copilotToken,
  githubToken: state.githubToken,
  vsCodeVersion: state.vsCodeVersion,
}
let nextCompletionResponse: Response | null = null

// Helper to mock fetch
const fetchMock = mock((url: string) => {
  if (url.includes("/copilot_internal/v2/token")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          expires_at: 1_700_000_000,
          refresh_in: 900,
          token: "copilot-test-token",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    )
  }

  if (nextCompletionResponse) {
    const response = nextCompletionResponse
    nextCompletionResponse = null
    return Promise.resolve(response)
  }

  return Promise.resolve(
    new Response(
      JSON.stringify({ id: "123", object: "chat.completion", choices: [] }),
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    ),
  )
})
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

beforeEach(() => {
  fetchMock.mockClear()
  nextCompletionResponse = null
  state.accountType = "individual"
  state.copilotToken = "test-token"
  state.githubToken = "ghu-test-token"
  state.vsCodeVersion = "1.0.0"
})

afterAll(() => {
  globalThis.fetch = originalFetch
  state.accountType = originalState.accountType
  state.copilotToken = originalState.copilotToken
  state.githubToken = originalState.githubToken
  state.vsCodeVersion = originalState.vsCodeVersion
})

test("sets X-Initiator to agent if tool/assistant present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls.at(-1)?.[1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("agent")
})

test("sets X-Initiator to user if only user present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls.at(-1)?.[1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("user")
})

test("returns the raw streaming response when stream is enabled", async () => {
  nextCompletionResponse = new Response("data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  })

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "stream please" }],
    model: "gpt-test",
    stream: true,
  }

  const result = await createChatCompletions(payload)

  expect(result).toBeInstanceOf(Response)
  expect((result as Response).headers.get("content-type")).toContain(
    "text/event-stream",
  )
  expect(await (result as Response).text()).toBe("data: [DONE]\n\n")
})

test("normalizes provider-specific chat completion responses", () => {
  const originalNow = Date.now
  Date.now = () => 1_700_000_000_000

  try {
    const normalized = normalizeChatCompletionResponse(
      {
        id: "chatcmpl-123",
        model: "gpt-5-mini",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello!",
              // Provider-specific fields should not leak through the proxy shape.
              padding: "abcdefghijklmnopqrstuv",
            } as unknown as {
              role: "assistant"
              content: string | null
            },
            logprobs: undefined as unknown as object | null,
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 139,
          total_tokens: 152,
        },
      } as unknown as ChatCompletionResponse,
      "gpt-5-mini",
    )

    expect(normalized.object).toBe("chat.completion")
    expect(normalized.created).toBe(Math.floor(1_700_000_000_000 / 1000))
    expect(normalized.model).toBe("gpt-5-mini")
    expect(normalized.choices[0]?.message).toEqual({
      role: "assistant",
      content: "Hello!",
    })
  } finally {
    Date.now = originalNow
  }
})
