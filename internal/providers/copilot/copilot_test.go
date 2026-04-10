package copilot

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"omnimodel/internal/cif"
)

func TestCopilotAdapterExecute_UsesResponsesAPIForGPT54Models(t *testing.T) {
	var chatCalls int
	var responsesCalls int
	var capturedPayload map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/chat/completions":
			chatCalls++
			http.Error(w, "chat/completions should not be used for gpt-5.4-mini", http.StatusTeapot)
		case "/v1/responses":
			responsesCalls++
			if err := json.NewDecoder(r.Body).Decode(&capturedPayload); err != nil {
				t.Fatalf("failed to decode request payload: %v", err)
			}

			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id":     "resp_123",
				"model":  "gpt-5.4-mini-2026-03-17",
				"status": "completed",
				"output": []map[string]interface{}{
					{
						"type": "message",
						"id":   "msg_123",
						"content": []map[string]interface{}{
							{"type": "output_text", "text": "pong"},
						},
					},
				},
				"usage": map[string]interface{}{
					"input_tokens":  6,
					"output_tokens": 1,
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	systemPrompt := "Be terse."
	maxTokens := 32
	response, err := adapter.Execute(&cif.CanonicalRequest{
		Model:        "gpt-5.4-mini",
		SystemPrompt: &systemPrompt,
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "ping"},
				},
			},
		},
		MaxTokens: &maxTokens,
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}

	if chatCalls != 0 {
		t.Fatalf("expected no /chat/completions calls, got %d", chatCalls)
	}
	if responsesCalls != 1 {
		t.Fatalf("expected one /v1/responses call, got %d", responsesCalls)
	}
	if response.ID != "resp_123" {
		t.Fatalf("unexpected response id: %q", response.ID)
	}
	if response.Model != "gpt-5.4-mini-2026-03-17" {
		t.Fatalf("unexpected response model: %q", response.Model)
	}
	if len(response.Content) != 1 {
		t.Fatalf("expected one content part, got %d", len(response.Content))
	}
	textPart, ok := response.Content[0].(cif.CIFTextPart)
	if !ok || textPart.Text != "pong" {
		t.Fatalf("unexpected response content: %#v", response.Content)
	}

	if capturedPayload["model"] != "gpt-5.4-mini" {
		t.Fatalf("unexpected model in upstream payload: %#v", capturedPayload["model"])
	}
	if capturedPayload["instructions"] != "Be terse." {
		t.Fatalf("unexpected instructions: %#v", capturedPayload["instructions"])
	}
	if capturedPayload["store"] != false {
		t.Fatalf("expected store=false, got %#v", capturedPayload["store"])
	}
	if capturedPayload["stream"] != false {
		t.Fatalf("expected stream=false, got %#v", capturedPayload["stream"])
	}

	input, ok := capturedPayload["input"].([]interface{})
	if !ok || len(input) != 1 {
		t.Fatalf("unexpected input payload: %#v", capturedPayload["input"])
	}
	message, ok := input[0].(map[string]interface{})
	if !ok || message["type"] != "message" || message["role"] != "user" {
		t.Fatalf("unexpected message item: %#v", input[0])
	}
	content, ok := message["content"].([]interface{})
	if !ok || len(content) != 1 {
		t.Fatalf("unexpected message content: %#v", message["content"])
	}
	block, ok := content[0].(map[string]interface{})
	if !ok || block["type"] != "input_text" || block["text"] != "ping" {
		t.Fatalf("unexpected content block: %#v", content[0])
	}
}

func TestCopilotAdapterRemapModel_NormalizesAliases(t *testing.T) {
	provider := NewGitHubCopilotProvider("github-copilot-test")
	adapter := provider.GetAdapter().(*CopilotAdapter)

	testCases := map[string]string{
		"gpt-4":                      "gpt-4o",
		"gpt-3.5-turbo":              "gpt-4o-mini",
		"haiku":                      "claude-haiku-4.5",
		"claude-haiku-4-5-20251001":  "claude-haiku-4.5",
		"sonnet-4.6":                 "claude-sonnet-4.6",
		"claude-sonnet-4-6-20241022": "claude-sonnet-4.6",
	}

	for input, expected := range testCases {
		if got := adapter.RemapModel(input); got != expected {
			t.Fatalf("RemapModel(%q) = %q, expected %q", input, got, expected)
		}
	}
}

func TestCopilotAdapterExecute_ClampsResponsesMaxOutputTokens(t *testing.T) {
	var capturedPayload map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}

		if err := json.NewDecoder(r.Body).Decode(&capturedPayload); err != nil {
			t.Fatalf("failed to decode request payload: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":     "resp_min_tokens",
			"model":  "gpt-5.4-2026-03-17",
			"status": "completed",
			"output": []map[string]interface{}{
				{
					"type": "message",
					"id":   "msg_min_tokens",
					"content": []map[string]interface{}{
						{"type": "output_text", "text": "pong"},
					},
				},
			},
		})
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	maxTokens := 1
	_, err := adapter.Execute(&cif.CanonicalRequest{
		Model: "gpt-5.4",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "ping"},
				},
			},
		},
		MaxTokens: &maxTokens,
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}

	if capturedPayload["max_output_tokens"] != float64(16) {
		t.Fatalf("expected max_output_tokens to be clamped to 16, got %#v", capturedPayload["max_output_tokens"])
	}
}

func TestCopilotAdapterExecute_ClampsUserIDForCopilotLimits(t *testing.T) {
	var capturedPayload map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}

		if err := json.NewDecoder(r.Body).Decode(&capturedPayload); err != nil {
			t.Fatalf("failed to decode request payload: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":     "resp_user_limit",
			"model":  "gpt-5.4-2026-03-17",
			"status": "completed",
			"output": []map[string]interface{}{
				{
					"type": "message",
					"id":   "msg_user_limit",
					"content": []map[string]interface{}{
						{"type": "output_text", "text": "pong"},
					},
				},
			},
		})
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	longUserID := strings.Repeat("user-", 30)
	_, err := adapter.Execute(&cif.CanonicalRequest{
		Model: "gpt-5.4",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "ping"},
				},
			},
		},
		UserID: &longUserID,
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}

	userValue, ok := capturedPayload["user"].(string)
	if !ok {
		t.Fatalf("expected string user payload, got %#v", capturedPayload["user"])
	}
	if len(userValue) != copilotMaxUserIDLength {
		t.Fatalf("expected user value to be clamped to %d chars, got %d (%q)", copilotMaxUserIDLength, len(userValue), userValue)
	}
}

func TestCopilotAdapterExecute_TranslatesSpecificToolChoiceForChatCompletions(t *testing.T) {
	var capturedPayload map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}

		if err := json.NewDecoder(r.Body).Decode(&capturedPayload); err != nil {
			t.Fatalf("failed to decode request payload: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":    "chatcmpl_tool_choice",
			"model": "claude-haiku-4.5",
			"choices": []map[string]interface{}{
				{
					"index": 0,
					"message": map[string]interface{}{
						"role":    "assistant",
						"content": "pong",
					},
					"finish_reason": "stop",
				},
			},
		})
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	_, err := adapter.Execute(&cif.CanonicalRequest{
		Model: "claude-haiku-4.5",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "Use the weather tool."},
				},
			},
		},
		Tools: []cif.CIFTool{
			{
				Name: "get_weather",
				ParametersSchema: map[string]interface{}{
					"type": "object",
				},
			},
		},
		ToolChoice: map[string]interface{}{
			"type":         "function",
			"functionName": "get_weather",
		},
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}

	toolChoice, ok := capturedPayload["tool_choice"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected object tool_choice, got %#v", capturedPayload["tool_choice"])
	}
	if toolChoice["type"] != "function" {
		t.Fatalf("unexpected tool_choice type: %#v", toolChoice)
	}
	function, ok := toolChoice["function"].(map[string]interface{})
	if !ok || function["name"] != "get_weather" {
		t.Fatalf("unexpected tool_choice function payload: %#v", toolChoice["function"])
	}
}

func TestCopilotAdapterExecute_FallsBackToResponsesWhenChatCompletionsIsUnsupported(t *testing.T) {
	var chatCalls int
	var responsesCalls int

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/chat/completions":
			chatCalls++
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"error": map[string]interface{}{
					"message": "model \"future-copilot-model\" is not accessible via the /chat/completions endpoint",
					"code":    "unsupported_api_for_model",
					"type":    "invalid_request_error",
				},
			})
		case "/v1/responses":
			responsesCalls++
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"id":     "resp_fallback",
				"model":  "future-copilot-model-2026-04-01",
				"status": "completed",
				"output": []map[string]interface{}{
					{
						"type": "message",
						"id":   "msg_fallback",
						"content": []map[string]interface{}{
							{"type": "output_text", "text": "fallback-ok"},
						},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	response, err := adapter.Execute(&cif.CanonicalRequest{
		Model: "future-copilot-model",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "ping"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}

	if chatCalls != 1 {
		t.Fatalf("expected one /chat/completions call before fallback, got %d", chatCalls)
	}
	if responsesCalls != 1 {
		t.Fatalf("expected one /v1/responses fallback call, got %d", responsesCalls)
	}

	textPart, ok := response.Content[0].(cif.CIFTextPart)
	if !ok || textPart.Text != "fallback-ok" {
		t.Fatalf("unexpected fallback response content: %#v", response.Content)
	}
}

func TestCopilotAdapterExecuteStream_ParsesResponsesSSE(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(strings.TrimSpace(`
event: response.created
data: {"response":{"id":"resp_stream","model":"gpt-5.4-mini-2026-03-17","status":"in_progress","output":[]}}

event: response.output_text.delta
data: {"output_index":0,"content_index":0,"delta":"pong"}

event: response.completed
data: {"response":{"id":"resp_stream","model":"gpt-5.4-mini-2026-03-17","status":"completed","output":[{"type":"message","id":"msg_stream","content":[{"type":"output_text","text":"pong"}]}],"usage":{"input_tokens":7,"output_tokens":1}}}
`) + "\n\n"))
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	eventCh, err := adapter.ExecuteStream(&cif.CanonicalRequest{
		Model: "gpt-5.4-mini",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "ping"},
				},
			},
		},
		Stream: true,
	})
	if err != nil {
		t.Fatalf("ExecuteStream returned error: %v", err)
	}

	var events []cif.CIFStreamEvent
	for event := range eventCh {
		events = append(events, event)
	}

	if len(events) != 3 {
		t.Fatalf("expected 3 stream events, got %d", len(events))
	}

	startEvent, ok := events[0].(cif.CIFStreamStart)
	if !ok || startEvent.ID != "resp_stream" || startEvent.Model != "gpt-5.4-mini-2026-03-17" {
		t.Fatalf("unexpected stream start event: %#v", events[0])
	}

	deltaEvent, ok := events[1].(cif.CIFContentDelta)
	if !ok {
		t.Fatalf("unexpected delta event type: %#v", events[1])
	}
	if _, ok := deltaEvent.ContentBlock.(cif.CIFTextPart); !ok {
		t.Fatalf("expected text content block, got %#v", deltaEvent.ContentBlock)
	}
	textDelta, ok := deltaEvent.Delta.(cif.TextDelta)
	if !ok || textDelta.Text != "pong" {
		t.Fatalf("unexpected text delta: %#v", deltaEvent.Delta)
	}

	endEvent, ok := events[2].(cif.CIFStreamEnd)
	if !ok {
		t.Fatalf("unexpected end event type: %#v", events[2])
	}
	if endEvent.StopReason != cif.StopReasonEndTurn {
		t.Fatalf("unexpected stop reason: %q", endEvent.StopReason)
	}
	if endEvent.Usage == nil || endEvent.Usage.InputTokens != 7 || endEvent.Usage.OutputTokens != 1 {
		t.Fatalf("unexpected usage: %#v", endEvent.Usage)
	}
}

func TestCopilotAdapterExecute_AliasesLongToolNamesForChatCompletions(t *testing.T) {
	var capturedPayload map[string]interface{}
	var upstreamToolName string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}

		if err := json.NewDecoder(r.Body).Decode(&capturedPayload); err != nil {
			t.Fatalf("failed to decode request payload: %v", err)
		}

		tools, ok := capturedPayload["tools"].([]interface{})
		if !ok || len(tools) != 1 {
			t.Fatalf("unexpected tools payload: %#v", capturedPayload["tools"])
		}
		tool, ok := tools[0].(map[string]interface{})
		if !ok {
			t.Fatalf("unexpected tool payload: %#v", tools[0])
		}
		function, ok := tool["function"].(map[string]interface{})
		if !ok {
			t.Fatalf("unexpected function payload: %#v", tool["function"])
		}
		upstreamToolName, _ = function["name"].(string)
		if len(upstreamToolName) > copilotMaxToolNameLength {
			t.Fatalf("expected aliased tool name to fit Copilot limit, got %d chars (%q)", len(upstreamToolName), upstreamToolName)
		}

		toolChoice, ok := capturedPayload["tool_choice"].(map[string]interface{})
		if !ok {
			t.Fatalf("expected object tool_choice, got %#v", capturedPayload["tool_choice"])
		}
		choiceFunction, ok := toolChoice["function"].(map[string]interface{})
		if !ok || choiceFunction["name"] != upstreamToolName {
			t.Fatalf("expected aliased tool_choice name, got %#v", toolChoice)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":    "chatcmpl_long_tool",
			"model": "claude-haiku-4.5",
			"choices": []map[string]interface{}{
				{
					"index": 0,
					"message": map[string]interface{}{
						"role":    "assistant",
						"content": nil,
						"tool_calls": []map[string]interface{}{
							{
								"id":   "call_long_tool",
								"type": "function",
								"function": map[string]interface{}{
									"name":      upstreamToolName,
									"arguments": `{"query":"ping"}`,
								},
							},
						},
					},
					"finish_reason": "tool_calls",
				},
			},
		})
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	originalToolName := "mcp__extremely_long_server_name_that_keeps_going__tool_name_that_is_also_long"
	response, err := adapter.Execute(&cif.CanonicalRequest{
		Model: "claude-haiku-4.5",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "Use the MCP tool."},
				},
			},
		},
		Tools: []cif.CIFTool{
			{
				Name: originalToolName,
				ParametersSchema: map[string]interface{}{
					"type": "object",
				},
			},
		},
		ToolChoice: map[string]interface{}{
			"type":         "function",
			"functionName": originalToolName,
		},
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}

	if upstreamToolName == "" {
		t.Fatal("expected upstream tool name to be captured")
	}
	if upstreamToolName == originalToolName {
		t.Fatalf("expected long tool name to be aliased before upstream request, got %q", upstreamToolName)
	}

	if len(response.Content) != 1 {
		t.Fatalf("expected one content part, got %d", len(response.Content))
	}
	toolCall, ok := response.Content[0].(cif.CIFToolCallPart)
	if !ok {
		t.Fatalf("expected tool call response, got %#v", response.Content[0])
	}
	if toolCall.ToolName != originalToolName {
		t.Fatalf("expected tool name to be restored to original %q, got %q", originalToolName, toolCall.ToolName)
	}
}

func TestCopilotAdapterExecute_AliasesLongToolNamesForResponsesAPI(t *testing.T) {
	var capturedPayload map[string]interface{}
	var upstreamToolName string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}

		if err := json.NewDecoder(r.Body).Decode(&capturedPayload); err != nil {
			t.Fatalf("failed to decode request payload: %v", err)
		}

		tools, ok := capturedPayload["tools"].([]interface{})
		if !ok || len(tools) != 1 {
			t.Fatalf("unexpected tools payload: %#v", capturedPayload["tools"])
		}
		tool, ok := tools[0].(map[string]interface{})
		if !ok {
			t.Fatalf("unexpected tool payload: %#v", tools[0])
		}
		upstreamToolName, _ = tool["name"].(string)
		if len(upstreamToolName) > copilotMaxToolNameLength {
			t.Fatalf("expected aliased tool name to fit Copilot limit, got %d chars (%q)", len(upstreamToolName), upstreamToolName)
		}

		toolChoice, ok := capturedPayload["tool_choice"].(map[string]interface{})
		if !ok {
			t.Fatalf("expected object tool_choice, got %#v", capturedPayload["tool_choice"])
		}
		choiceFunction, ok := toolChoice["function"].(map[string]interface{})
		if !ok || choiceFunction["name"] != upstreamToolName {
			t.Fatalf("expected aliased tool_choice name, got %#v", toolChoice)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":     "resp_long_tool",
			"model":  "gpt-5.4-2026-03-17",
			"status": "completed",
			"output": []map[string]interface{}{
				{
					"type":      "function_call",
					"id":        "tool_long_tool",
					"call_id":   "call_long_tool",
					"name":      upstreamToolName,
					"arguments": `{"query":"ping"}`,
				},
			},
		})
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	originalToolName := "mcp__extremely_long_server_name_that_keeps_going__tool_name_that_is_also_long"
	response, err := adapter.Execute(&cif.CanonicalRequest{
		Model: "gpt-5.4",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "Use the MCP tool."},
				},
			},
		},
		Tools: []cif.CIFTool{
			{
				Name: originalToolName,
				ParametersSchema: map[string]interface{}{
					"type": "object",
				},
			},
		},
		ToolChoice: map[string]interface{}{
			"type":         "function",
			"functionName": originalToolName,
		},
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}

	if upstreamToolName == "" {
		t.Fatal("expected upstream tool name to be captured")
	}
	if upstreamToolName == originalToolName {
		t.Fatalf("expected long tool name to be aliased before upstream request, got %q", upstreamToolName)
	}

	if len(response.Content) != 1 {
		t.Fatalf("expected one content part, got %d", len(response.Content))
	}
	toolCall, ok := response.Content[0].(cif.CIFToolCallPart)
	if !ok {
		t.Fatalf("expected tool call response, got %#v", response.Content[0])
	}
	if toolCall.ToolName != originalToolName {
		t.Fatalf("expected tool name to be restored to original %q, got %q", originalToolName, toolCall.ToolName)
	}
}

func TestCopilotAdapterExecute_NormalizesResponsesToolCallIDs(t *testing.T) {
	var capturedPayload map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			http.NotFound(w, r)
			return
		}

		if err := json.NewDecoder(r.Body).Decode(&capturedPayload); err != nil {
			t.Fatalf("failed to decode request payload: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":     "resp_norm_ids",
			"model":  "gpt-5.4-mini-2026-03-17",
			"status": "completed",
			"output": []map[string]interface{}{
				{
					"type": "message",
					"id":   "msg_norm_ids",
					"content": []map[string]interface{}{
						{"type": "output_text", "text": "done"},
					},
				},
			},
		})
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	_, err := adapter.Execute(&cif.CanonicalRequest{
		Model: "gpt-5.4-mini",
		Messages: []cif.CIFMessage{
			cif.CIFAssistantMessage{
				Role: "assistant",
				Content: []cif.CIFContentPart{
					cif.CIFToolCallPart{
						Type:          "tool_call",
						ToolCallID:    "tooluse_abc123",
						ToolName:      "shell_command",
						ToolArguments: map[string]interface{}{"command": "pwd"},
					},
				},
			},
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFToolResultPart{
						Type:       "tool_result",
						ToolCallID: "tooluse_abc123",
						ToolName:   "shell_command",
						Content:    "C:/repo",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}

	input, ok := capturedPayload["input"].([]interface{})
	if !ok || len(input) != 2 {
		t.Fatalf("unexpected responses input payload: %#v", capturedPayload["input"])
	}

	functionCall, ok := input[0].(map[string]interface{})
	if !ok {
		t.Fatalf("unexpected function_call payload: %#v", input[0])
	}
	if functionCall["type"] != "function_call" {
		t.Fatalf("expected first input item to be function_call, got %#v", functionCall)
	}
	if functionCall["id"] != "fc_abc123" || functionCall["call_id"] != "fc_abc123" {
		t.Fatalf("expected normalized responses tool call IDs, got %#v", functionCall)
	}

	functionCallOutput, ok := input[1].(map[string]interface{})
	if !ok {
		t.Fatalf("unexpected function_call_output payload: %#v", input[1])
	}
	if functionCallOutput["type"] != "function_call_output" {
		t.Fatalf("expected second input item to be function_call_output, got %#v", functionCallOutput)
	}
	if functionCallOutput["call_id"] != "fc_abc123" {
		t.Fatalf("expected normalized tool result call_id, got %#v", functionCallOutput)
	}
}

func TestCopilotAdapterExecuteStream_RestoresAliasedToolNamesForChatCompletions(t *testing.T) {
	originalToolName := "mcp__extremely_long_server_name_that_keeps_going__tool_name_that_is_also_long"
	var upstreamToolName string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}

		var payload map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("failed to decode request payload: %v", err)
		}

		tools, ok := payload["tools"].([]interface{})
		if !ok || len(tools) != 1 {
			t.Fatalf("unexpected tools payload: %#v", payload["tools"])
		}
		tool, ok := tools[0].(map[string]interface{})
		if !ok {
			t.Fatalf("unexpected tool payload: %#v", tools[0])
		}
		function, ok := tool["function"].(map[string]interface{})
		if !ok {
			t.Fatalf("unexpected function payload: %#v", tool["function"])
		}
		upstreamToolName, _ = function["name"].(string)

		w.Header().Set("Content-Type", "text/event-stream")
		sseBody := fmt.Sprintf(strings.TrimSpace(`
data: {"id":"chatcmpl_stream_long_tool","model":"claude-haiku-4.5","choices":[{"index":0,"delta":{"role":"assistant"}}]}

data: {"id":"chatcmpl_stream_long_tool","model":"claude-haiku-4.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_stream_long_tool","type":"function","function":{"name":"%s"}}]}}]}

data: {"id":"chatcmpl_stream_long_tool","model":"claude-haiku-4.5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"query\":\"ping\"}"}}]}}]}

data: {"id":"chatcmpl_stream_long_tool","model":"claude-haiku-4.5","choices":[{"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":3}}
`), upstreamToolName)
		_, _ = w.Write([]byte(sseBody + "\n\n"))
	}))
	defer server.Close()

	provider := NewGitHubCopilotProvider("github-copilot-test")
	provider.baseURL = server.URL
	provider.token = "test-token"
	adapter := provider.GetAdapter().(*CopilotAdapter)

	eventCh, err := adapter.ExecuteStream(&cif.CanonicalRequest{
		Model: "claude-haiku-4.5",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "Use the MCP tool."},
				},
			},
		},
		Tools: []cif.CIFTool{
			{
				Name: originalToolName,
				ParametersSchema: map[string]interface{}{
					"type": "object",
				},
			},
		},
		Stream: true,
	})
	if err != nil {
		t.Fatalf("ExecuteStream returned error: %v", err)
	}

	var restoredToolName string
	for event := range eventCh {
		contentDelta, ok := event.(cif.CIFContentDelta)
		if !ok || contentDelta.ContentBlock == nil {
			continue
		}
		toolCall, ok := contentDelta.ContentBlock.(cif.CIFToolCallPart)
		if !ok {
			continue
		}
		restoredToolName = toolCall.ToolName
		break
	}

	if upstreamToolName == "" {
		t.Fatal("expected upstream tool name to be captured")
	}
	if upstreamToolName == originalToolName {
		t.Fatalf("expected long tool name to be aliased before upstream request, got %q", upstreamToolName)
	}
	if restoredToolName != originalToolName {
		t.Fatalf("expected streamed tool name to be restored to %q, got %q", originalToolName, restoredToolName)
	}
}
