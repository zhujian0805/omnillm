import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import {
  authAndCreateProvider,
  type Provider,
} from "../../frontend/src/api"

import {
  resetTestEnvironment,
  setupFetchMocks,
  setupTestEnvironment,
} from "./setup"

describe("authAndCreateProvider", () => {
  let mockFetch: ReturnType<typeof mock> | null = null

  beforeEach(() => {
    setupTestEnvironment()
  })

  afterEach(() => {
    resetTestEnvironment()
    mockFetch?.mockClear()
  })

  test("posts to the auth-and-create endpoint and returns direct-success providers", async () => {
    const provider: Provider = {
      id: "github-copilot",
      type: "github-copilot",
      name: "GitHub Copilot (octocat)",
      isActive: false,
      authStatus: "authenticated",
    }

    mockFetch = setupFetchMocks(globalThis, {
      "/api/admin/info": {
        GET: { response: { version: "test", port: 4141 } },
      },
      "/api/admin/providers/auth-and-create/github-copilot": {
        POST: {
          response: {
            success: true,
            provider,
          },
        },
      },
    })

    const result = await authAndCreateProvider("github-copilot", {
      method: "token",
      token: "gh-test-token",
    })

    expect(result.success).toBe(true)
    expect(result.provider).toEqual(provider)

    const authCall = mockFetch.mock.calls.find(([url]) => {
      const path = new URL(String(url), "http://localhost:4141").pathname
      return path === "/api/admin/providers/auth-and-create/github-copilot"
    })

    expect(authCall).toBeDefined()
    expect(authCall?.[1]?.method).toBe("POST")
    expect(authCall?.[1]?.body).toBe(
      JSON.stringify({ method: "token", token: "gh-test-token" }),
    )
  })

  test("preserves pending auth metadata for device-code flows", async () => {
    mockFetch = setupFetchMocks(globalThis, {
      "/api/admin/info": {
        GET: { response: { version: "test", port: 4141 } },
      },
      "/api/admin/providers/auth-and-create/alibaba": {
        POST: {
          response: {
            success: false,
            requiresAuth: true,
            pending_id: "alibaba-pending",
            user_code: "QWEN-CODE",
            verification_uri:
              "https://chat.qwen.ai/authorize?user_code=QWEN-CODE&prompt=login",
            message: "Visit the browser flow",
          },
        },
      },
    })

    const result = await authAndCreateProvider("alibaba", {
      method: "oauth",
    })

    expect(result.success).toBe(false)
    expect(result.requiresAuth).toBe(true)
    expect(result.pending_id).toBe("alibaba-pending")
    expect(result.user_code).toBe("QWEN-CODE")
    expect(result.verification_uri).toContain("prompt=login")
  })
})
