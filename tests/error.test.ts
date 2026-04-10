import { expect, test } from "bun:test"
import { Hono } from "hono"

import {
  describeErrorResponse,
  forwardError,
  HTTPError,
  isModelNotSupportedError,
  parseErrorPayload,
  summarizeHTTPError,
} from "../src/lib/error"

test("parseErrorPayload decodes nested JSON error messages", () => {
  const payload = parseErrorPayload({
    error: {
      code: 400,
      message: JSON.stringify({
        error: {
          message: "nested message",
          status: "INVALID_ARGUMENT",
        },
      }),
    },
  })

  expect(payload).toEqual({
    error: {
      code: 400,
      message: {
        error: {
          message: "nested message",
          status: "INVALID_ARGUMENT",
        },
      },
    },
  })
})

test("summarizeHTTPError maps Antigravity verification errors", () => {
  const message = summarizeHTTPError({
    error: {
      code: 403,
      message: "Verify your account to continue.",
      status: "PERMISSION_DENIED",
    },
  })

  expect(message).toContain("Antigravity account verification is required.")
})

test("summarizeHTTPError rewrites unsupported_api_for_model errors", () => {
  const message = summarizeHTTPError({
    error: {
      message:
        'model "gpt-5.4-mini" is not accessible via the /chat/completions endpoint',
      code: "unsupported_api_for_model",
    },
  })

  expect(message).toBe(
    'Model "gpt-5.4-mini" is not supported on the upstream /chat/completions endpoint. Use the proxy\'s /v1/responses endpoint or switch to a model that supports chat completions.',
  )
})

test("describeErrorResponse includes status and parsed body", async () => {
  const description = await describeErrorResponse(
    new Response(
      JSON.stringify({
        error: {
          message: "upstream failed",
          code: "bad_request",
        },
      }),
      {
        status: 400,
        statusText: "Bad Request",
        headers: {
          "Content-Type": "application/json",
        },
      },
    ),
  )

  expect(description).toEqual({
    status: 400,
    statusText: "Bad Request",
    body: {
      error: {
        message: "upstream failed",
        code: "bad_request",
      },
    },
  })
})

test("isModelNotSupportedError recognizes provider model support errors", async () => {
  const error = new HTTPError(
    "model not supported",
    new Response(
      JSON.stringify({
        error: {
          message: "The requested model is not supported.",
          code: "model_not_supported",
        },
      }),
      {
        status: 400,
        statusText: "Bad Request",
        headers: {
          "Content-Type": "application/json",
        },
      },
    ),
  )

  await expect(isModelNotSupportedError(error)).resolves.toBe(true)
})

test("forwardError falls back gracefully when the upstream body was already consumed", async () => {
  const upstream = new Response(
    JSON.stringify({
      error: {
        message: "upstream failed",
        code: "bad_request",
      },
    }),
    {
      status: 400,
      statusText: "Bad Request",
      headers: {
        "Content-Type": "application/json",
      },
    },
  )

  await upstream.text()

  const app = new Hono()
  app.get("/", async (c) =>
    forwardError(c, new HTTPError("upstream failed", upstream)),
  )

  const response = await app.request("http://localhost/")
  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toEqual({
    error: {
      message: "upstream failed",
      type: "error",
    },
  })
})
