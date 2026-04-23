package serialization

import (
	"encoding/json"
	"fmt"
	"omnillm/internal/cif"
	"strings"
	"time"
)

// ResponsesResponse is the non-streaming Responses API response object.
// Spec: https://platform.openai.com/docs/api-reference/responses/object
type ResponsesResponse struct {
	ID        string                `json:"id"`
	Object    string                `json:"object"`    // always "response"
	CreatedAt int64                 `json:"created_at"`
	Status    string                `json:"status"`    // "completed" | "incomplete" | "failed"
	Model     string                `json:"model"`
	Output    []ResponsesOutputItem `json:"output"`
	OutputText string               `json:"output_text,omitempty"` // convenience helper: concatenated text
	Usage     *ResponsesUsage       `json:"usage,omitempty"`
}

type ResponsesOutputItem struct {
	Type      string                  `json:"type"`
	ID        string                  `json:"id"`
	CallID    string                  `json:"call_id,omitempty"`
	Role      string                  `json:"role"`
	Status    string                  `json:"status,omitempty"` // "completed" | "incomplete" | "in_progress"
	Content   []ResponsesContentBlock `json:"content,omitempty"`
	Name      string                  `json:"name,omitempty"`
	Arguments string                  `json:"arguments,omitempty"`
}

type ResponsesContentBlock struct {
	Type        string `json:"type"`
	Text        string `json:"text,omitempty"`
	Annotations []any  `json:"annotations,omitempty"`
}

type ResponsesUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

func SerializeToResponses(response *cif.CanonicalResponse) (*ResponsesResponse, error) {
	var outputItems []ResponsesOutputItem
	var contentBlocks []ResponsesContentBlock

	for _, part := range response.Content {
		switch p := part.(type) {
		case cif.CIFTextPart:
			contentBlocks = append(contentBlocks, ResponsesContentBlock{
				Type:        "output_text",
				Text:        p.Text,
				Annotations: []any{},
			})
		case cif.CIFThinkingPart:
			contentBlocks = append(contentBlocks, ResponsesContentBlock{
				Type:        "output_text",
				Text:        fmt.Sprintf("<thinking>\n%s\n</thinking>", p.Thinking),
				Annotations: []any{},
			})
		case cif.CIFToolCallPart:
			args, _ := json.Marshal(p.ToolArguments)
			outputItems = append(outputItems, ResponsesOutputItem{
				Type:      "function_call",
				ID:        p.ToolCallID,
				CallID:    p.ToolCallID,
				Role:      "assistant",
				Status:    "completed",
				Name:      p.ToolName,
				Arguments: string(args),
			})
		}
	}

	// Build the top-level status from CIF stop reason.
	status := responsesStatus(response.StopReason)

	// Prepend the message item (text blocks) before any function_call items.
	if len(contentBlocks) > 0 {
		messageItem := ResponsesOutputItem{
			Type:    "message",
			ID:      fmt.Sprintf("%s-message", response.ID),
			Role:    "assistant",
			Status:  "completed",
			Content: contentBlocks,
		}
		outputItems = append([]ResponsesOutputItem{messageItem}, outputItems...)
	}

	// output_text helper: concatenate all output_text blocks in order.
	outputText := buildOutputText(outputItems)

	resp := &ResponsesResponse{
		ID:         response.ID,
		Object:     "response",
		CreatedAt:  time.Now().Unix(),
		Status:     status,
		Model:      response.Model,
		Output:     outputItems,
		OutputText: outputText,
	}

	if response.Usage != nil {
		resp.Usage = &ResponsesUsage{
			InputTokens:  response.Usage.InputTokens,
			OutputTokens: response.Usage.OutputTokens,
			TotalTokens:  response.Usage.InputTokens + response.Usage.OutputTokens,
		}
	}

	return resp, nil
}

// responsesStatus maps a CIF stop reason to the Responses API top-level status field.
func responsesStatus(reason cif.CIFStopReason) string {
	switch reason {
	case cif.StopReasonMaxTokens, cif.StopReasonContentFilter:
		return "incomplete"
	case cif.StopReasonError:
		return "failed"
	default:
		return "completed"
	}
}

// buildOutputText concatenates all output_text block texts from a message item, in order.
func buildOutputText(items []ResponsesOutputItem) string {
	var sb strings.Builder
	for _, item := range items {
		if item.Type != "message" {
			continue
		}
		for _, block := range item.Content {
			if block.Type == "output_text" {
				sb.WriteString(block.Text)
			}
		}
	}
	return sb.String()
}

// ─────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────

type ResponsesStreamState struct {
	ResponseID         string
	Model              string
	CurrentItemID      string
	CurrentToolItemID  string
	CurrentContentText string
	MessageItemAdded   bool
	outputItems        []map[string]interface{}
	// textBlockDone guards against double-emission of output_text.done when
	// both CIFContentBlockStop and CIFStreamEnd fire for the same block.
	textBlockDone bool
}

func CreateResponsesStreamState() *ResponsesStreamState {
	return &ResponsesStreamState{}
}

func ConvertCIFEventToResponsesSSE(event cif.CIFStreamEvent, state *ResponsesStreamState) ([]map[string]interface{}, error) {
	var events []map[string]interface{}

	switch e := event.(type) {
	case cif.CIFStreamStart:
		state.ResponseID = e.ID
		state.Model = e.Model
		state.CurrentItemID = fmt.Sprintf("%s-message", e.ID)
		state.CurrentContentText = ""
		state.MessageItemAdded = false
		state.textBlockDone = false
		state.outputItems = nil

		events = append(events, map[string]interface{}{
			"type": "response.created",
			"response": map[string]interface{}{
				"id":         e.ID,
				"object":     "response",
				"status":     "in_progress",
				"model":      e.Model,
				"output":     []interface{}{},
				"created_at": time.Now().Unix(),
			},
		})

	case cif.CIFContentDelta:
		if e.ContentBlock != nil {
			switch cb := e.ContentBlock.(type) {
			case cif.CIFTextPart, cif.CIFThinkingPart:
				_ = cb
				if !state.MessageItemAdded {
					events = append(events, map[string]interface{}{
						"type":         "response.output_item.added",
						"output_index": e.Index,
						"item": map[string]interface{}{
							"type":    "message",
							"id":      state.CurrentItemID,
							"role":    "assistant",
							"status":  "in_progress",
							"content": []interface{}{},
						},
					})
					events = append(events, map[string]interface{}{
						"type":          "response.content_block.added",
						"output_index":  e.Index,
						"content_index": 0,
						"content_block": map[string]interface{}{
							"type":        "output_text",
							"text":        "",
							"annotations": []interface{}{},
						},
					})
					state.MessageItemAdded = true
				}
			case cif.CIFToolCallPart:
				toolItem := map[string]interface{}{
					"type":      "function_call",
					"id":        cb.ToolCallID,
					"call_id":   cb.ToolCallID,
					"role":      "assistant",
					"status":    "in_progress",
					"name":      cb.ToolName,
					"arguments": "",
				}
				events = append(events, map[string]interface{}{
					"type":         "response.output_item.added",
					"output_index": e.Index,
					"item":         toolItem,
				})
				state.CurrentToolItemID = cb.ToolCallID
				state.outputItems = append(state.outputItems, toolItem)
			}
		}

		switch d := e.Delta.(type) {
		case cif.TextDelta:
			state.CurrentContentText += d.Text
			events = append(events, map[string]interface{}{
				"type":          "response.output_text.delta",
				"output_index":  e.Index,
				"content_index": 0,
				"delta":         d.Text,
			})
		case cif.ThinkingDelta:
			state.CurrentContentText += d.Thinking
			events = append(events, map[string]interface{}{
				"type":          "response.output_text.delta",
				"output_index":  e.Index,
				"content_index": 0,
				"delta":         d.Thinking,
			})
		case cif.ToolArgumentsDelta:
			if state.CurrentToolItemID != "" {
				for _, item := range state.outputItems {
					if item["call_id"] == state.CurrentToolItemID {
						item["arguments"] = item["arguments"].(string) + d.PartialJSON
						break
					}
				}
				events = append(events, map[string]interface{}{
					"type":         "response.function_call_arguments.delta",
					"output_index": e.Index,
					"delta":        d.PartialJSON,
				})
			}
		}

	case cif.CIFContentBlockStop:
		if state.MessageItemAdded && !state.textBlockDone {
			// Emit content_block.done before output_item.done per spec.
			events = append(events, map[string]interface{}{
				"type":          "response.content_block.done",
				"output_index":  e.Index,
				"content_index": 0,
				"content_block": map[string]interface{}{
					"type":        "output_text",
					"text":        state.CurrentContentText,
					"annotations": []interface{}{},
				},
			})
			events = append(events, map[string]interface{}{
				"type":          "response.output_text.done",
				"output_index":  e.Index,
				"content_index": 0,
				"text":          state.CurrentContentText,
			})
			messageItem := map[string]interface{}{
				"type":   "message",
				"id":     state.CurrentItemID,
				"role":   "assistant",
				"status": "completed",
				"content": []map[string]interface{}{
					{
						"type":        "output_text",
						"text":        state.CurrentContentText,
						"annotations": []interface{}{},
					},
				},
			}
			events = append(events, map[string]interface{}{
				"type":         "response.output_item.done",
				"output_index": e.Index,
				"item":         messageItem,
			})
			state.outputItems = append([]map[string]interface{}{messageItem}, state.outputItems...)
			state.textBlockDone = true
		}

	case cif.CIFStreamEnd:
		// Only emit text done events if CIFContentBlockStop hasn't already done so.
		if state.MessageItemAdded && !state.textBlockDone {
			events = append(events, map[string]interface{}{
				"type":          "response.content_block.done",
				"output_index":  0,
				"content_index": 0,
				"content_block": map[string]interface{}{
					"type":        "output_text",
					"text":        state.CurrentContentText,
					"annotations": []interface{}{},
				},
			})
			events = append(events, map[string]interface{}{
				"type":          "response.output_text.done",
				"output_index":  0,
				"content_index": 0,
				"text":          state.CurrentContentText,
			})
			messageItem := map[string]interface{}{
				"type":   "message",
				"id":     state.CurrentItemID,
				"role":   "assistant",
				"status": "completed",
				"content": []map[string]interface{}{
					{
						"type":        "output_text",
						"text":        state.CurrentContentText,
						"annotations": []interface{}{},
					},
				},
			}
			events = append(events, map[string]interface{}{
				"type":         "response.output_item.done",
				"output_index": 0,
				"item":         messageItem,
			})
			state.outputItems = append([]map[string]interface{}{messageItem}, state.outputItems...)
			state.textBlockDone = true
		}

		// Emit function_call_arguments.done for any pending tool calls.
		for _, item := range state.outputItems {
			if item["type"] == "function_call" {
				events = append(events, map[string]interface{}{
					"type":      "response.function_call_arguments.done",
					"call_id":   item["call_id"],
					"arguments": item["arguments"],
				})
				// Mark tool item as completed.
				item["status"] = "completed"
				events = append(events, map[string]interface{}{
					"type":         "response.output_item.done",
					"output_index": 0,
					"item":         item,
				})
			}
		}

		var output []interface{}
		for _, item := range state.outputItems {
			output = append(output, item)
		}
		if output == nil {
			output = []interface{}{}
		}

		// Build output_text convenience field.
		var sb strings.Builder
		for _, item := range state.outputItems {
			if item["type"] != "message" {
				continue
			}
			if blocks, ok := item["content"].([]map[string]interface{}); ok {
				for _, b := range blocks {
					if b["type"] == "output_text" {
						if t, ok := b["text"].(string); ok {
							sb.WriteString(t)
						}
					}
				}
			}
		}

		completedResp := map[string]interface{}{
			"type": "response.completed",
			"response": map[string]interface{}{
				"id":          state.ResponseID,
				"object":      "response",
				"status":      "completed",
				"model":       state.Model,
				"output":      output,
				"output_text": sb.String(),
				"created_at":  time.Now().Unix(),
			},
		}
		if e.Usage != nil {
			completedResp["response"].(map[string]interface{})["usage"] = map[string]interface{}{
				"input_tokens":  e.Usage.InputTokens,
				"output_tokens": e.Usage.OutputTokens,
				"total_tokens":  e.Usage.InputTokens + e.Usage.OutputTokens,
			}
		}
		events = append(events, completedResp)
	}

	return events, nil
}
