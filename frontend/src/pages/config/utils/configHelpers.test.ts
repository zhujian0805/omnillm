import { describe, expect, test } from "bun:test"

import {
  createEmptyAMPConfig,
  createEmptyDroidConfig,
  createEmptyOpenCodeConfig,
  normalizeAMPConfig,
  normalizeDroidConfig,
  normalizeOpenCodeConfig,
} from "../../../../frontend/src/pages/config/utils/configHelpers"

describe("configHelpers", () => {
  test("normalizeOpenCodeConfig fills missing nested defaults", () => {
    const result = normalizeOpenCodeConfig({})

    expect(result.features).toEqual({})
    expect(result.mcp).toEqual({ servers: [] })
    expect(result.skills).toEqual({ paths: [] })
  })

  test("createEmptyOpenCodeConfig returns empty defaults", () => {
    expect(createEmptyOpenCodeConfig()).toEqual({
      features: {},
      mcp: { servers: [] },
      skills: { paths: [] },
    })
  })

  test("normalizeAMPConfig fills missing sections", () => {
    const result = normalizeAMPConfig({})

    expect(result.models).toEqual({ default: "", providers: [], custom: [] })
    expect(result.features).toEqual({})
    expect(result.ui).toEqual({})
    expect(result.logging).toEqual({})
  })

  test("createEmptyAMPConfig returns empty defaults", () => {
    expect(createEmptyAMPConfig()).toEqual({
      models: { default: "", providers: [], custom: [] },
      features: {},
      ui: {},
      logging: {},
    })
  })

  test("normalizeDroidConfig fills missing sections", () => {
    const result = normalizeDroidConfig({})

    expect(result.customModels).toEqual([])
    expect(result.providers).toEqual({ default: {} })
    expect(result.features).toEqual({})
    expect(result.logging).toEqual({})
    expect(result.ui).toEqual({})
    expect(result.enabledPlugins).toEqual({})
  })

  test("createEmptyDroidConfig returns empty defaults", () => {
    expect(createEmptyDroidConfig()).toEqual({
      customModels: [],
      providers: { default: {} },
      features: {},
      logging: {},
      ui: {},
      enabledPlugins: {},
    })
  })
})
