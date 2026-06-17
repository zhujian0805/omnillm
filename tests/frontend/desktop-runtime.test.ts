import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import {
  __resetApiCachesForTests,
  listProviders,
} from "../../frontend/src/api"
import {
  getDesktopBackend,
  isDesktop,
  setDesktopBackend,
} from "../../frontend/src/lib/runtime"
import {
  resetTestEnvironment,
  setupFetchMocks,
  setupTestEnvironment,
} from "./setup"

describe("desktop runtime hook", () => {
  beforeEach(() => {
    setupTestEnvironment()
    setDesktopBackend(null)
    __resetApiCachesForTests()
  })

  afterEach(() => {
    setDesktopBackend(null)
    __resetApiCachesForTests()
    resetTestEnvironment()
  })

  test("isDesktop is false by default (browser mode)", () => {
    expect(isDesktop()).toBe(false)
    expect(getDesktopBackend()).toBeNull()
  })

  test("isDesktop is true when bridge is set", () => {
    setDesktopBackend({
      baseUrl: "http://127.0.0.1:34211",
      apiKey: "deadbeef",
    })
    expect(isDesktop()).toBe(true)
    const info = getDesktopBackend()
    expect(info).not.toBeNull()
    expect(info!.baseUrl).toBe("http://127.0.0.1:34211")
    expect(info!.apiKey).toBe("deadbeef")
  })

  test("getDesktopBackend strips trailing slashes", () => {
    setDesktopBackend({
      baseUrl: "http://127.0.0.1:34211//",
      apiKey: "k",
    })
    expect(getDesktopBackend()!.baseUrl).toBe("http://127.0.0.1:34211")
  })

  test("apiFetch routes through desktop bridge baseUrl + apiKey", async () => {
    setDesktopBackend({
      baseUrl: "http://127.0.0.1:34211",
      apiKey: "tauri-key",
    })

    const mockFetch = setupFetchMocks(globalThis, {
      "/api/admin/info": {
        GET: { response: { version: "test", port: 34211 } },
      },
      "/api/admin/providers": {
        GET: { response: [] },
      },
    })

    await listProviders()

    // Find the providers call.
    const providerCall = mockFetch.mock.calls.find((call: unknown[]) => {
      const url = String(call[0])
      return url.endsWith("/api/admin/providers")
    })
    expect(providerCall).toBeDefined()
    const url = String(providerCall![0])
    expect(url.startsWith("http://127.0.0.1:34211/")).toBe(true)
    expect(url).toBe("http://127.0.0.1:34211/api/admin/providers")

    const opts = providerCall![1] as { headers?: Headers } | undefined
    const headers = opts?.headers as Headers | undefined
    expect(headers).toBeDefined()
    expect(headers!.get("Authorization")).toBe("Bearer tauri-key")
  })

  test("apiFetch falls back to default behavior when bridge is absent", async () => {
    // Ensure no bridge.
    setDesktopBackend(null)

    const mockFetch = setupFetchMocks(globalThis, {
      "/api/admin/info": {
        GET: { response: { version: "test", port: 4141 } },
      },
      "/api/admin/providers": {
        GET: { response: [] },
      },
    })

    await listProviders()

    const providerCall = mockFetch.mock.calls.find((call: unknown[]) => {
      const url = String(call[0])
      return url.endsWith("/api/admin/providers")
    })
    expect(providerCall).toBeDefined()
    const url = String(providerCall![0])
    // Default behavior: localhost-prefixed (auto-detected port).
    expect(url.includes("localhost")).toBe(true)
  })

  test("setDesktopBackend(null) clears bridge", () => {
    setDesktopBackend({ baseUrl: "http://x", apiKey: "k" })
    expect(isDesktop()).toBe(true)
    setDesktopBackend(null)
    expect(isDesktop()).toBe(false)
    expect(getDesktopBackend()).toBeNull()
  })
})

// Silence ESLint about unused mock when bun:test re-exports it elsewhere.
void mock
