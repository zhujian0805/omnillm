package routes

import (
	"encoding/json"
	"strings"

	"omnimodel/internal/cif"

	"github.com/rs/zerolog/log"
)

const toolLoopLogValueLimit = 400

type toolLoopResultLogEntry struct {
	MessageIndex  int
	ItemIndex     int
	ToolCallID    string
	ToolName      string
	ResultPreview string
	IsError       *bool
}

type toolLoopCallLogEntry struct {
	BlockIndex       int
	ToolCallID       string
	ToolName         string
	ArgumentsPreview string
}

type toolLoopCallTracker struct {
	callsByIndex map[int]*toolLoopCallState
	order        []int
}

type toolLoopCallState struct {
	blockIndex int
	toolCallID string
	toolName   string
	rawArgs    strings.Builder
}

func newToolLoopCallTracker() *toolLoopCallTracker {
	return &toolLoopCallTracker{
		callsByIndex: make(map[int]*toolLoopCallState),
	}
}

func (t *toolLoopCallTracker) Observe(event cif.CIFStreamEvent) {
	if t == nil {
		return
	}

	delta, ok := event.(cif.CIFContentDelta)
	if !ok {
		return
	}

	if contentBlock, ok := delta.ContentBlock.(cif.CIFToolCallPart); ok {
		state := t.ensure(delta.Index)
		if contentBlock.ToolCallID != "" {
			state.toolCallID = contentBlock.ToolCallID
		}
		if contentBlock.ToolName != "" {
			state.toolName = contentBlock.ToolName
		}
		if state.rawArgs.Len() == 0 && len(contentBlock.ToolArguments) > 0 {
			state.rawArgs.WriteString(mustMarshalCompactJSON(contentBlock.ToolArguments))
		}
	}

	argsDelta, ok := delta.Delta.(cif.ToolArgumentsDelta)
	if !ok || strings.TrimSpace(argsDelta.PartialJSON) == "" {
		return
	}

	state := t.ensure(delta.Index)
	state.rawArgs.WriteString(argsDelta.PartialJSON)
}

func (t *toolLoopCallTracker) Entries() []toolLoopCallLogEntry {
	if t == nil {
		return nil
	}

	entries := make([]toolLoopCallLogEntry, 0, len(t.order))
	for _, idx := range t.order {
		state := t.callsByIndex[idx]
		if state == nil {
			continue
		}
		entries = append(entries, toolLoopCallLogEntry{
			BlockIndex:       state.blockIndex,
			ToolCallID:       state.toolCallID,
			ToolName:         state.toolName,
			ArgumentsPreview: truncateToolLoopValue(state.rawArgs.String()),
		})
	}
	return entries
}

func (t *toolLoopCallTracker) ensure(index int) *toolLoopCallState {
	if state, ok := t.callsByIndex[index]; ok {
		return state
	}

	state := &toolLoopCallState{blockIndex: index}
	t.callsByIndex[index] = state
	t.order = append(t.order, index)
	return state
}

func extractLatestToolResultLogEntries(request *cif.CanonicalRequest) []toolLoopResultLogEntry {
	if request == nil {
		return nil
	}

	for messageIndex := len(request.Messages) - 1; messageIndex >= 0; messageIndex-- {
		userMessage, ok := request.Messages[messageIndex].(cif.CIFUserMessage)
		if !ok {
			continue
		}

		entries := make([]toolLoopResultLogEntry, 0, len(userMessage.Content))
		for itemIndex, part := range userMessage.Content {
			toolResult, ok := part.(cif.CIFToolResultPart)
			if !ok {
				continue
			}
			entries = append(entries, toolLoopResultLogEntry{
				MessageIndex:  messageIndex,
				ItemIndex:     itemIndex,
				ToolCallID:    toolResult.ToolCallID,
				ToolName:      toolResult.ToolName,
				ResultPreview: truncateToolLoopValue(toolResult.Content),
				IsError:       toolResult.IsError,
			})
		}
		if len(entries) > 0 {
			return entries
		}
	}

	return nil
}

func extractToolCallLogEntriesFromResponse(response *cif.CanonicalResponse) []toolLoopCallLogEntry {
	if response == nil {
		return nil
	}

	entries := make([]toolLoopCallLogEntry, 0, len(response.Content))
	for blockIndex, part := range response.Content {
		toolCall, ok := part.(cif.CIFToolCallPart)
		if !ok {
			continue
		}
		entries = append(entries, toolLoopCallLogEntry{
			BlockIndex:       blockIndex,
			ToolCallID:       toolCall.ToolCallID,
			ToolName:         toolCall.ToolName,
			ArgumentsPreview: truncateToolLoopValue(mustMarshalCompactJSON(toolCall.ToolArguments)),
		})
	}
	return entries
}

func logAnthropicToolLoopRequest(requestID string, request *cif.CanonicalRequest) {
	for _, entry := range extractLatestToolResultLogEntries(request) {
		event := log.Info().
			Str("request_id", requestID).
			Str("api_shape", "anthropic").
			Str("model_requested", request.Model).
			Int("loop_message_index", entry.MessageIndex).
			Int("loop_item_index", entry.ItemIndex).
			Str("tool_call_id", entry.ToolCallID).
			Str("tool_name", entry.ToolName).
			Str("tool_result", entry.ResultPreview)
		if entry.IsError != nil {
			event = event.Bool("tool_is_error", *entry.IsError)
		}
		event.Msg("TOOL LOOP inbound tool_result")
	}
}

func logAnthropicToolLoopResponse(requestID string, originalModel string, modelUsed string, providerID string, stream bool, entries []toolLoopCallLogEntry) {
	for _, entry := range entries {
		log.Info().
			Str("request_id", requestID).
			Str("api_shape", "anthropic").
			Str("model_requested", originalModel).
			Str("model_used", modelUsed).
			Str("provider", providerID).
			Bool("stream", stream).
			Int("loop_block_index", entry.BlockIndex).
			Str("tool_call_id", entry.ToolCallID).
			Str("tool_name", entry.ToolName).
			Str("tool_arguments", entry.ArgumentsPreview).
			Msg("TOOL LOOP outbound tool_call")
	}
}

func truncateToolLoopValue(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) <= toolLoopLogValueLimit {
		return trimmed
	}
	return trimmed[:toolLoopLogValueLimit] + "...(truncated)"
}

func mustMarshalCompactJSON(value interface{}) string {
	if value == nil {
		return ""
	}
	jsonBytes, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(jsonBytes)
}
