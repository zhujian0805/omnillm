import { describe, expect, test } from "bun:test"

import {
  parseTOML,
  serializeTOML,
} from "../../../../frontend/src/pages/config/utils/tomlParser"

describe("tomlParser", () => {
  test("parseTOML reads top-level values and sections", () => {
    const parsed = parseTOML(`model = "gpt-5.4"
profile = 'default'

[model_providers."copilot-api"]
name = "copilot-api"
base_url = "http://localhost:5000"
env_key = "API_KEY_COPILOT"

[profiles."default"]
model = "gpt-5.4"
model_provider = "copilot-api"
model_reasoning_effort = "medium"
sandbox = "elevated"

[projects.'C:\\Users\\jzhu']
trust_level = "trusted"
`)

    expect(parsed.model).toBe("gpt-5.4")
    expect(parsed.profile).toBe("default")
    expect(parsed.model_providers?.["copilot-api"]?.base_url).toBe("http://localhost:5000")
    expect(parsed.profiles?.default?.model_provider).toBe("copilot-api")
    expect(parsed.projects?.["C:\\Users\\jzhu"]?.trust_level).toBe("trusted")
  })

  test("parseTOML skips nested subsections", () => {
    const parsed = parseTOML(`[profiles."default"]
model = "gpt-5.4"

[profiles."default".windows]
sandbox = "elevated"
`)

    expect(parsed.profiles?.default?.model).toBe("gpt-5.4")
    expect(parsed.profiles?.default?.sandbox).toBe("")
  })

  test("serializeTOML updates tracked values while preserving structure", () => {
    const original = `model = "gpt-5.4"
profile = 'default'

[model_providers."copilot-api"]
name = "copilot-api"
base_url = "http://localhost:5000"
env_key = "API_KEY_COPILOT"
`

    const updated = serializeTOML(
      {
        model: "gpt-5-mini",
        profile: "mini",
        model_providers: {
          "copilot-api": {
            name: "copilot-api",
            base_url: "http://localhost:6000",
            env_key: "API_KEY_NEW",
          },
        },
      },
      original,
    )

    expect(updated).toContain('model = "gpt-5-mini"')
    expect(updated).toContain("profile = 'mini'")
    expect(updated).toContain('base_url = "http://localhost:6000"')
    expect(updated).toContain('env_key = "API_KEY_NEW"')
  })
})
