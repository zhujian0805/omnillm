import { expect, test } from "bun:test"

import type { ResponsesPayload } from "../src/routes/responses/types"
import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import {
  chatCompletionsToResponsesPayload,
  translateRequestToOpenAI,
} from "../src/routes/responses/translation"

test("chatCompletionsToResponsesPayload uses plain string content for message input", () => {
  const payload: ChatCompletionsPayload = {
    model: "gpt-5.4-mini",
    messages: [
      { role: "system", content: "Be terse." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ],
    stream: true,
    max_tokens: 32,
  }

  expect(chatCompletionsToResponsesPayload(payload)).toEqual({
    model: "gpt-5.4-mini",
    input: [
      { type: "message", role: "user", content: "Hello" },
      { type: "message", role: "assistant", content: "Hi" },
    ],
    instructions: "Be terse.",
    stream: true,
    max_output_tokens: 32,
    temperature: undefined,
    top_p: undefined,
  })
})

test("translateRequestToOpenAI accepts output_text content arrays", () => {
  const payload: ResponsesPayload = {
    model: "gpt-5.4-mini",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "output_text", text: "Hello" }],
      },
    ],
  }

  expect(translateRequestToOpenAI(payload)).toMatchObject({
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Hello" }],
  })
})
