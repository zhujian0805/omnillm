import { describe, expect, test } from "bun:test"

import type { AuthFlow, Provider } from "../../frontend/src/api"

import { getDeviceAuthCopy } from "../../frontend/src/lib/device-auth"

describe("getDeviceAuthCopy", () => {
  const alibabaProvider: Provider = {
    id: "alibaba-2",
    type: "alibaba",
    name: "Alibaba DashScope",
    isActive: false,
    authStatus: "unauthenticated",
  }

  const githubProvider: Provider = {
    id: "github-copilot-1",
    type: "github-copilot",
    name: "GitHub Copilot",
    isActive: false,
    authStatus: "unauthenticated",
  }

  test("returns consistent auth copy for all providers since OAuth was removed", () => {
    const authFlow: AuthFlow = {
      providerId: "alibaba-2",
      status: "awaiting_user",
      userCode: "JGPYTR1R",
      instructionURL: "https://example.com/auth",
    }

    const copy = getDeviceAuthCopy(authFlow, [alibabaProvider])

    expect(copy.codeLabel).toBe("Enter this code:")
    expect(copy.codeHint).toBeUndefined()
    expect(copy.waitingLabel).toBe("Waiting for authorization…")
  })

  test("returns same auth copy for non-Alibaba providers", () => {
    const authFlow: AuthFlow = {
      providerId: "github-copilot-1",
      status: "awaiting_user",
      userCode: "ABCD-1234",
      instructionURL: "https://github.com/login/device",
    }

    const copy = getDeviceAuthCopy(authFlow, [githubProvider])

    expect(copy.codeLabel).toBe("Enter this code:")
    expect(copy.codeHint).toBeUndefined()
    expect(copy.waitingLabel).toBe("Waiting for authorization…")
  })
})
