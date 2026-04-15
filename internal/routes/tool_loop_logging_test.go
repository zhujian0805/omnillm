package routes

import (
	"strings"
	"testing"

	"omnimodel/internal/cif"
)

func TestExtractLatestToolResultLogEntriesUsesMostRecentUserToolResults(t *testing.T) {
	isError := true
	longResult := strings.Repeat("result-", 80)
	request := &cif.CanonicalRequest{
		Model: "qwen3.6-plus",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFToolResultPart{
						Type:       "tool_result",
						ToolCallID: "older_call",
						ToolName:   "old_tool",
						Content:    "old result",
					},
				},
			},
			cif.CIFAssistantMessage{
				Role: "assistant",
				Content: []cif.CIFContentPart{
					cif.CIFToolCallPart{
						Type:          "tool_call",
						ToolCallID:    "call_fs",
						ToolName:      "read_file",
						ToolArguments: map[string]interface{}{"path": "/tmp/demo"},
					},
				},
			},
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "tool output follows"},
					cif.CIFToolResultPart{
						Type:       "tool_result",
						ToolCallID: "call_fs",
						ToolName:   "read_file",
						Content:    longResult,
						IsError:    &isError,
					},
				},
			},
		},
	}

	entries := extractLatestToolResultLogEntries(request)
	if len(entries) != 1 {
		t.Fatalf("expected 1 latest tool result entry, got %d", len(entries))
	}

	entry := entries[0]
	if entry.MessageIndex != 2 {
		t.Fatalf("expected latest message index 2, got %d", entry.MessageIndex)
	}
	if entry.ItemIndex != 1 {
		t.Fatalf("expected latest item index 1, got %d", entry.ItemIndex)
	}
	if entry.ToolCallID != "call_fs" {
		t.Fatalf("expected tool call id call_fs, got %q", entry.ToolCallID)
	}
	if entry.ToolName != "read_file" {
		t.Fatalf("expected tool name read_file, got %q", entry.ToolName)
	}
	if entry.IsError == nil || !*entry.IsError {
		t.Fatalf("expected is_error=true, got %#v", entry.IsError)
	}
	if !strings.HasSuffix(entry.ResultPreview, "...(truncated)") {
		t.Fatalf("expected truncated result preview, got %q", entry.ResultPreview)
	}
}

func TestExtractToolCallLogEntriesFromResponseCapturesArguments(t *testing.T) {
	response := &cif.CanonicalResponse{
		ID:    "resp_1",
		Model: "qwen3.6-plus",
		Content: []cif.CIFContentPart{
			cif.CIFTextPart{Type: "text", Text: "working"},
			cif.CIFToolCallPart{
				Type:          "tool_call",
				ToolCallID:    "call_1",
				ToolName:      "list_files",
				ToolArguments: map[string]interface{}{"dir": "/tmp"},
			},
		},
		StopReason: cif.StopReasonToolUse,
	}

	entries := extractToolCallLogEntriesFromResponse(response)
	if len(entries) != 1 {
		t.Fatalf("expected 1 tool call entry, got %d", len(entries))
	}
	if entries[0].BlockIndex != 1 {
		t.Fatalf("expected block index 1, got %d", entries[0].BlockIndex)
	}
	if entries[0].ToolCallID != "call_1" {
		t.Fatalf("expected tool call id call_1, got %q", entries[0].ToolCallID)
	}
	if entries[0].ToolName != "list_files" {
		t.Fatalf("expected tool name list_files, got %q", entries[0].ToolName)
	}
	if entries[0].ArgumentsPreview != `{"dir":"/tmp"}` {
		t.Fatalf("unexpected arguments preview: %q", entries[0].ArgumentsPreview)
	}
}

func TestToolLoopCallTrackerAccumulatesStreamedArguments(t *testing.T) {
	tracker := newToolLoopCallTracker()

	tracker.Observe(cif.CIFContentDelta{
		Type:  "content_delta",
		Index: 3,
		ContentBlock: cif.CIFToolCallPart{
			Type:          "tool_call",
			ToolCallID:    "call_loop",
			ToolName:      "search_files",
			ToolArguments: map[string]interface{}{},
		},
		Delta: cif.ToolArgumentsDelta{Type: "tool_arguments_delta", PartialJSON: ""},
	})
	tracker.Observe(cif.CIFContentDelta{
		Type:  "content_delta",
		Index: 3,
		Delta: cif.ToolArgumentsDelta{Type: "tool_arguments_delta", PartialJSON: `{"pattern":"TODO",`},
	})
	tracker.Observe(cif.CIFContentDelta{
		Type:  "content_delta",
		Index: 3,
		Delta: cif.ToolArgumentsDelta{Type: "tool_arguments_delta", PartialJSON: `"path":"src"}`},
	})

	entries := tracker.Entries()
	if len(entries) != 1 {
		t.Fatalf("expected 1 tracked tool call, got %d", len(entries))
	}
	entry := entries[0]
	if entry.BlockIndex != 3 {
		t.Fatalf("expected block index 3, got %d", entry.BlockIndex)
	}
	if entry.ToolCallID != "call_loop" {
		t.Fatalf("expected tool call id call_loop, got %q", entry.ToolCallID)
	}
	if entry.ToolName != "search_files" {
		t.Fatalf("expected tool name search_files, got %q", entry.ToolName)
	}
	if entry.ArgumentsPreview != `{"pattern":"TODO","path":"src"}` {
		t.Fatalf("unexpected accumulated arguments: %q", entry.ArgumentsPreview)
	}
}
