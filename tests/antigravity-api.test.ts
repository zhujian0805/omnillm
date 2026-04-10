import { expect, test } from "bun:test"

import { getAntigravityHeaders } from "../src/providers/antigravity/api"

test("does not send x-goog-user-project for antigravity requests", () => {
  const headers = getAntigravityHeaders("test-token")

  expect(headers.Authorization).toBe("Bearer test-token")
  expect(headers["x-goog-user-project"]).toBeUndefined()
})
