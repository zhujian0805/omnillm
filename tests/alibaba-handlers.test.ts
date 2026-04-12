import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

import { AlibabaProvider } from "~/providers/alibaba/handlers"

const originalFetch = globalThis.fetch

const fetchMock = mock((_url: string, _init?: RequestInit) =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: "qwen3-coder-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "pong" },
            finish_reason: "stop",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ),
  ),
)

// @ts-expect-error - mocked fetch is enough for these tests
globalThis.fetch = fetchMock

describe("AlibabaProvider adapter (CIF)", () => {
  beforeEach(() => {
    fetchMock.mockClear()
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  function makeOAuthProvider() {
    const provider = new AlibabaProvider("alibaba-oauth-test")
    ;(
      provider as unknown as {
        tokenData: {
          auth_type: "oauth"
          access_token: string
          refresh_token: string
          resource_url: string
          expires_at: number
          base_url: string
        }
      }
    ).tokenData = {
      auth_type: "oauth",
      access_token: "test-token",
      refresh_token: "refresh-token",
      resource_url: "portal.qwen.ai",
      expires_at: Date.now() + 10 * 60_000,
      base_url: "",
    }
    return provider
  }

  test("injects the Qwen OAuth system message when none is provided", async () => {
    const provider = makeOAuthProvider()

    await provider.adapter.execute({
      model: "qwen3-coder-flash",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      stream: false,
    })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(init.body as string) as {
      messages: Array<Record<string, unknown>>
    }

    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are Qwen Code.",
    })
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "hi",
    })
  })

  test("merges existing system text into the injected Qwen OAuth system message", async () => {
    const provider = makeOAuthProvider()

    await provider.adapter.execute({
      model: "qwen3-coder-flash",
      systemPrompt: "Be concise.",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      stream: false,
    })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(init.body as string) as {
      messages: Array<Record<string, unknown>>
    }

    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are Qwen Code.\n\nBe concise.",
    })
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "hi",
    })
  })
})
