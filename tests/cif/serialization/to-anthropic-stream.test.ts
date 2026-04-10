import { describe, expect, test } from "bun:test"

import type { CIFStreamEvent } from "~/cif/types"

import {
  cifEventToAnthropicSSE,
  createAnthropicStreamState,
} from "~/serialization/to-anthropic-stream"

describe("cifEventToAnthropicSSE", () => {
  test("closes a text block before opening a streamed tool block", () => {
    const state = createAnthropicStreamState()
    const events: Array<unknown> = []
    const streamEvents: Array<CIFStreamEvent> = [
      {
        type: "stream_start",
        id: "stream_123",
        model: "claude-sonnet-4.6",
      },
      {
        type: "content_delta",
        index: 0,
        contentBlock: { type: "text", text: "" },
        delta: { type: "text_delta", text: "Let me explore the codebase." },
      },
      {
        type: "content_delta",
        index: 0,
        contentBlock: {
          type: "tool_call",
          toolCallId: "call_123",
          toolName: "shell_command",
          toolArguments: {},
        },
        delta: {
          type: "tool_arguments_delta",
          partialJson: '{"command":"rg --files"}',
        },
      },
      {
        type: "stream_end",
        stopReason: "tool_use",
        stopSequence: null,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
        },
      },
    ]

    for (const streamEvent of streamEvents) {
      events.push(...cifEventToAnthropicSSE(streamEvent, state))
    }

    expect(events).toEqual([
      {
        type: "message_start",
        message: {
          id: "stream_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4.6",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "text",
          text: "",
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: "Let me explore the codebase.",
        },
      },
      {
        type: "content_block_stop",
        index: 0,
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "call_123",
          name: "shell_command",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: '{"command":"rg --files"}',
        },
      },
      {
        type: "content_block_stop",
        index: 1,
      },
      {
        type: "message_delta",
        delta: {
          stop_reason: "tool_use",
          stop_sequence: null,
        },
        usage: {
          output_tokens: 5,
        },
      },
      {
        type: "message_stop",
      },
    ])
  })
})
