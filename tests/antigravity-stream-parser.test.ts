import { expect, test } from "bun:test"

test("antigravity SSE lines can be parsed after stripping the data prefix", async () => {
  const module = await import("../src/providers/antigravity/handlers")
  const parse = module.__test__.parseAntigravityStreamLine as (
    line: string,
  ) => unknown

  expect(
    parse('data: {"response":{"modelVersion":"claude","candidates":[]}}'),
  ).toEqual({
    response: {
      modelVersion: "claude",
      candidates: [],
    },
  })
})

test("antigravity SSE parser ignores done markers", async () => {
  const module = await import("../src/providers/antigravity/handlers")
  const parse = module.__test__.parseAntigravityStreamLine as (
    line: string,
  ) => unknown

  expect(parse("data: [DONE]")).toBeNull()
})
