package generic

import (
	"testing"

	"omnimodel/internal/cif"
)

func TestBuildOpenAIPayloadIncludesSystemPrompt(t *testing.T) {
	provider := NewGenericProvider("azure-openai", "azure-openai-test", "Azure OpenAI")
	adapter := &GenericAdapter{provider: provider}

	systemPrompt := "Be concise."
	request := &cif.CanonicalRequest{
		Model:        "gpt-4o",
		SystemPrompt: &systemPrompt,
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "hello"},
				},
			},
		},
	}

	payload := adapter.buildOpenAIPayload(request)
	messages, ok := payload["messages"].([]map[string]interface{})
	if !ok {
		t.Fatalf("messages payload has unexpected type %T", payload["messages"])
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0]["role"] != "system" {
		t.Fatalf("expected first role to be system, got %v", messages[0]["role"])
	}
	if messages[0]["content"] != systemPrompt {
		t.Fatalf("expected system prompt %q, got %v", systemPrompt, messages[0]["content"])
	}
	if messages[1]["role"] != "user" {
		t.Fatalf("expected second role to be user, got %v", messages[1]["role"])
	}
}

func TestAlibabaOAuthBuildOpenAIPayloadInjectsQwenSystemMessage(t *testing.T) {
	provider := NewGenericProvider("alibaba", "alibaba-oauth-test", "Alibaba")
	provider.applyConfig(map[string]interface{}{
		"auth_type":    "oauth",
		"resource_url": "portal.qwen.ai",
	})
	adapter := &GenericAdapter{provider: provider}

	request := &cif.CanonicalRequest{
		Model: "qwen3-coder-flash",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "hello"},
				},
			},
		},
	}

	payload := adapter.buildOpenAIPayload(request)
	messages, ok := payload["messages"].([]map[string]interface{})
	if !ok {
		t.Fatalf("messages payload has unexpected type %T", payload["messages"])
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0]["role"] != "system" {
		t.Fatalf("expected first role to be system, got %v", messages[0]["role"])
	}
	if messages[0]["content"] != "You are Qwen Code." {
		t.Fatalf("expected Qwen system prompt, got %v", messages[0]["content"])
	}
}

func TestAlibabaOAuthBuildOpenAIPayloadMergesSystemPrompts(t *testing.T) {
	provider := NewGenericProvider("alibaba", "alibaba-oauth-test", "Alibaba")
	provider.applyConfig(map[string]interface{}{
		"auth_type":    "oauth",
		"resource_url": "portal.qwen.ai",
	})
	adapter := &GenericAdapter{provider: provider}

	systemPrompt := "Be concise."
	request := &cif.CanonicalRequest{
		Model:        "qwen3-coder-flash",
		SystemPrompt: &systemPrompt,
		Messages: []cif.CIFMessage{
			cif.CIFSystemMessage{
				Role:    "system",
				Content: "Use Markdown when helpful.",
			},
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "hello"},
				},
			},
		},
	}

	payload := adapter.buildOpenAIPayload(request)
	messages, ok := payload["messages"].([]map[string]interface{})
	if !ok {
		t.Fatalf("messages payload has unexpected type %T", payload["messages"])
	}
	if len(messages) != 2 {
		t.Fatalf("expected exactly one merged system message plus the user message, got %d", len(messages))
	}
	if messages[0]["role"] != "system" {
		t.Fatalf("expected first role to be system, got %v", messages[0]["role"])
	}

	want := "You are Qwen Code.\n\nBe concise.\n\nUse Markdown when helpful."
	if messages[0]["content"] != want {
		t.Fatalf("expected merged system prompt %q, got %v", want, messages[0]["content"])
	}
}

func TestAlibabaBuildOpenAIPayloadPreservesQwen36Plus(t *testing.T) {
	provider := NewGenericProvider("alibaba", "alibaba-test", "Alibaba")
	adapter := &GenericAdapter{provider: provider}

	payload := adapter.buildOpenAIPayload(&cif.CanonicalRequest{
		Model: "qwen3.6-plus",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "hello"},
				},
			},
		},
	})

	if payload["model"] != "qwen3.6-plus" {
		t.Fatalf("expected preserved model qwen3.6-plus, got %v", payload["model"])
	}
}

// TestAlibabaBuildOpenAIPayloadDummyToolHasToolChoiceNone verifies that when no
// real tools are in the request the dummy tool injection sets tool_choice to
// "none" so Qwen3 never calls the placeholder.
func TestAlibabaBuildOpenAIPayloadDummyToolHasToolChoiceNone(t *testing.T) {
	provider := NewGenericProvider("alibaba", "alibaba-test", "Alibaba")
	adapter := &GenericAdapter{provider: provider}

	payload := adapter.buildOpenAIPayload(&cif.CanonicalRequest{
		Model: "qwen3-coder-plus",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "hello"},
				},
			},
		},
		// No Tools — triggers dummy injection path.
	})

	tools, ok := payload["tools"].([]map[string]interface{})
	if !ok || len(tools) == 0 {
		t.Fatal("expected at least one tool in payload")
	}
	fn := tools[0]["function"].(map[string]interface{})
	if fn["name"] != "do_not_call_me" {
		t.Errorf("expected dummy tool name do_not_call_me, got %v", fn["name"])
	}

	toolChoice := payload["tool_choice"]
	if toolChoice != "none" {
		t.Errorf("expected tool_choice=none for dummy injection, got %v", toolChoice)
	}
}

// TestAlibabaBuildOpenAIPayloadRealToolsNoForcedNone verifies that when real
// tools are provided, tool_choice is NOT forced to "none".
func TestAlibabaBuildOpenAIPayloadRealToolsNoForcedNone(t *testing.T) {
	provider := NewGenericProvider("alibaba", "alibaba-test", "Alibaba")
	adapter := &GenericAdapter{provider: provider}

	desc := "Read a file"
	payload := adapter.buildOpenAIPayload(&cif.CanonicalRequest{
		Model: "qwen3-coder-plus",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role: "user",
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "read /etc/hosts"},
				},
			},
		},
		Tools: []cif.CIFTool{
			{
				Name:             "read_file",
				Description:      &desc,
				ParametersSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{"path": map[string]interface{}{"type": "string"}}},
			},
		},
	})

	tools, ok := payload["tools"].([]map[string]interface{})
	if !ok || len(tools) == 0 {
		t.Fatal("expected tools in payload")
	}
	fn := tools[0]["function"].(map[string]interface{})
	if fn["name"] != "read_file" {
		t.Errorf("expected real tool name read_file, got %v", fn["name"])
	}
	// tool_choice should NOT be "none" when real tools are present
	if toolChoice, ok := payload["tool_choice"]; ok && toolChoice == "none" {
		t.Errorf("tool_choice should not be 'none' when real tools are provided, got %v", toolChoice)
	}
}

// TestAlibabaChinaReasoningModelEnableThinking verifies that enable_thinking is
// injected when the provider uses the DashScope China endpoint with a reasoning model.
func TestAlibabaChinaReasoningModelEnableThinking(t *testing.T) {
	provider := NewGenericProvider("alibaba", "alibaba-cn-test", "Alibaba China")
	// Set the China base URL (no "-intl" in hostname).
	provider.baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	adapter := &GenericAdapter{provider: provider}

	payload := adapter.buildOpenAIPayload(&cif.CanonicalRequest{
		Model: "qwen3-max",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role:    "user",
				Content: []cif.CIFContentPart{cif.CIFTextPart{Type: "text", Text: "think"}},
			},
		},
	})

	if val, ok := payload["enable_thinking"]; !ok || val != true {
		t.Errorf("expected enable_thinking=true for China reasoning model, got %v (present=%v)", val, ok)
	}
}

// TestAlibabaGlobalNoEnableThinking verifies that enable_thinking is NOT set
// when the provider uses the international DashScope endpoint.
func TestAlibabaGlobalNoEnableThinking(t *testing.T) {
	provider := NewGenericProvider("alibaba", "alibaba-global-test", "Alibaba Global")
	provider.baseURL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
	adapter := &GenericAdapter{provider: provider}

	payload := adapter.buildOpenAIPayload(&cif.CanonicalRequest{
		Model: "qwen3-max",
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role:    "user",
				Content: []cif.CIFContentPart{cif.CIFTextPart{Type: "text", Text: "think"}},
			},
		},
	})

	if val, ok := payload["enable_thinking"]; ok {
		t.Errorf("expected enable_thinking to be absent for international endpoint, got %v", val)
	}
}

// TestAlibabaGlobalNonReasoningModelNoEnableThinking verifies that enable_thinking
// is NOT set for a non-reasoning model even on the China endpoint.
func TestAlibabaGlobalNonReasoningModelNoEnableThinking(t *testing.T) {
	provider := NewGenericProvider("alibaba", "alibaba-cn-test", "Alibaba China")
	provider.baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	adapter := &GenericAdapter{provider: provider}

	payload := adapter.buildOpenAIPayload(&cif.CanonicalRequest{
		Model: "qwen2-5-72b-instruct", // not a reasoning model
		Messages: []cif.CIFMessage{
			cif.CIFUserMessage{
				Role:    "user",
				Content: []cif.CIFContentPart{cif.CIFTextPart{Type: "text", Text: "hello"}},
			},
		},
	})

	if val, ok := payload["enable_thinking"]; ok {
		t.Errorf("expected enable_thinking to be absent for non-reasoning model, got %v", val)
	}
}
