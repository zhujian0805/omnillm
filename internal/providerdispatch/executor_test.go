package providerdispatch

import (
	"testing"

	"omnillm/internal/cif"
	"omnillm/internal/providers/types"
)

// stubCopilotProvider is the minimal types.Provider needed to exercise
// ApplyGitHubCopilotSingleUpstreamMode. We embed responsesOnly to optionally
// satisfy the copilotResponsesOnlyChecker interface.
type stubCopilotProvider struct {
	id                string
	responsesOnlySet  map[string]bool
	implementsChecker bool
}

func (p *stubCopilotProvider) GetID() string                             { return p.id }
func (p *stubCopilotProvider) GetInstanceID() string                     { return p.id }
func (p *stubCopilotProvider) GetName() string                           { return p.id }
func (p *stubCopilotProvider) SetName(string)                            {}
func (p *stubCopilotProvider) SetupAuth(*types.AuthOptions) error        { return nil }
func (p *stubCopilotProvider) GetToken() string                          { return "" }
func (p *stubCopilotProvider) RefreshToken() error                       { return nil }
func (p *stubCopilotProvider) GetBaseURL() string                        { return "" }
func (p *stubCopilotProvider) GetHeaders(bool) map[string]string         { return nil }
func (p *stubCopilotProvider) GetModels() (*types.ModelsResponse, error) { return nil, nil }
func (p *stubCopilotProvider) CreateChatCompletions(map[string]interface{}) (map[string]interface{}, error) {
	return nil, nil
}
func (p *stubCopilotProvider) CreateEmbeddings(map[string]interface{}) (map[string]interface{}, error) {
	return nil, nil
}
func (p *stubCopilotProvider) GetUsage() (map[string]interface{}, error) { return nil, nil }
func (p *stubCopilotProvider) GetAdapter() types.ProviderAdapter         { return nil }

// stubCopilotProviderWithChecker embeds stubCopilotProvider and adds the
// IsResponsesOnlyModel method so it satisfies copilotResponsesOnlyChecker.
type stubCopilotProviderWithChecker struct {
	*stubCopilotProvider
}

func (p *stubCopilotProviderWithChecker) IsResponsesOnlyModel(model string) bool {
	return p.responsesOnlySet[model]
}

func newCopilotProvider() *stubCopilotProvider {
	return &stubCopilotProvider{id: string(types.ProviderGitHubCopilot)}
}

func newCopilotProviderWithChecker(responsesOnly ...string) *stubCopilotProviderWithChecker {
	base := newCopilotProvider()
	base.responsesOnlySet = make(map[string]bool)
	for _, m := range responsesOnly {
		base.responsesOnlySet[m] = true
	}
	return &stubCopilotProviderWithChecker{stubCopilotProvider: base}
}

func stringPtr(s string) *string { return &s }

// --- Tests ----------------------------------------------------------------

func TestApplyGitHubCopilotSingleUpstreamMode_NonCopilotProviderUntouched(t *testing.T) {
	other := &stubCopilotProvider{id: "openai"}
	req := &cif.CanonicalRequest{Model: "gpt-4o"}
	ApplyGitHubCopilotSingleUpstreamMode(other, req)

	if req.Extensions != nil {
		t.Fatalf("expected Extensions untouched for non-Copilot provider, got %+v", req.Extensions)
	}
}

func TestApplyGitHubCopilotSingleUpstreamMode_ChatModelForcedToChat(t *testing.T) {
	req := &cif.CanonicalRequest{Model: "claude-opus-4.7"}
	ApplyGitHubCopilotSingleUpstreamMode(newCopilotProvider(), req)

	if req.Extensions == nil || req.Extensions.ForceChatCompletions == nil || !*req.Extensions.ForceChatCompletions {
		t.Fatalf("expected ForceChatCompletions=true for chat-friendly Copilot model, got %+v", req.Extensions)
	}
}

func TestApplyGitHubCopilotSingleUpstreamMode_GPT5FamilyNotForced(t *testing.T) {
	req := &cif.CanonicalRequest{Model: "gpt-5.5"}
	ApplyGitHubCopilotSingleUpstreamMode(newCopilotProvider(), req)

	if req.Extensions == nil {
		t.Fatal("expected Extensions to be initialized")
	}
	if req.Extensions.ForceChatCompletions != nil {
		t.Fatalf("expected ForceChatCompletions unset for GPT-5 family, got %v", *req.Extensions.ForceChatCompletions)
	}
}

// Regression test for issue #156: MAI-Code-1-Flash routed to /chat/completions.
//
// Inbound /v1/responses requests must NOT have ForceChatCompletions set,
// otherwise the Copilot adapter's selectShape strips them to /chat/completions
// and the upstream rejects with `unsupported_api_for_model`.
func TestApplyGitHubCopilotSingleUpstreamMode_InboundResponsesShapeNotForced(t *testing.T) {
	req := &cif.CanonicalRequest{
		Model: "mai-code-1-flash-picker",
		Extensions: &cif.Extensions{
			InboundAPIShape: stringPtr("responses"),
		},
	}
	ApplyGitHubCopilotSingleUpstreamMode(newCopilotProvider(), req)

	if req.Extensions.ForceChatCompletions != nil {
		t.Fatalf("expected ForceChatCompletions to stay unset when InboundAPIShape=\"responses\", got %v", *req.Extensions.ForceChatCompletions)
	}
}

// Regression test for issue #156: a non-GPT-5 Copilot model that is
// responses-only (per the model catalog) must not be forced to /chat/completions
// even when the inbound shape is something other than responses (e.g. a
// /v1/chat/completions caller asking for a responses-only model).
func TestApplyGitHubCopilotSingleUpstreamMode_ResponsesOnlyModelNotForced(t *testing.T) {
	req := &cif.CanonicalRequest{Model: "mai-code-1-flash-picker"}
	provider := newCopilotProviderWithChecker("mai-code-1-flash-picker")
	ApplyGitHubCopilotSingleUpstreamMode(provider, req)

	if req.Extensions.ForceChatCompletions != nil {
		t.Fatalf("expected ForceChatCompletions to stay unset for responses-only model, got %v", *req.Extensions.ForceChatCompletions)
	}
}

func TestApplyGitHubCopilotSingleUpstreamMode_KnownMAIResponsesOnlyModelNotForcedWithoutCatalog(t *testing.T) {
	req := &cif.CanonicalRequest{Model: "mai-code-1-flash-picker"}
	ApplyGitHubCopilotSingleUpstreamMode(newCopilotProvider(), req)

	if req.Extensions.ForceChatCompletions != nil {
		t.Fatalf("expected ForceChatCompletions to stay unset for known MAI responses-only model without catalog metadata, got %v", *req.Extensions.ForceChatCompletions)
	}
}

// DisableAuthRetry and DisableStreamingFallback must always be set for Copilot,
// regardless of which shape branch we take.
func TestApplyGitHubCopilotSingleUpstreamMode_AlwaysSetsDisableFlags(t *testing.T) {
	cases := []struct {
		name string
		req  *cif.CanonicalRequest
	}{
		{"chat model", &cif.CanonicalRequest{Model: "claude-opus-4.7"}},
		{"gpt-5", &cif.CanonicalRequest{Model: "gpt-5.5"}},
		{"inbound responses", &cif.CanonicalRequest{
			Model:      "mai-code-1-flash-picker",
			Extensions: &cif.Extensions{InboundAPIShape: stringPtr("responses")},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ApplyGitHubCopilotSingleUpstreamMode(newCopilotProvider(), tc.req)
			if tc.req.Extensions.DisableAuthRetry == nil || !*tc.req.Extensions.DisableAuthRetry {
				t.Errorf("expected DisableAuthRetry=true, got %v", tc.req.Extensions.DisableAuthRetry)
			}
			if tc.req.Extensions.DisableStreamingFallback == nil || !*tc.req.Extensions.DisableStreamingFallback {
				t.Errorf("expected DisableStreamingFallback=true, got %v", tc.req.Extensions.DisableStreamingFallback)
			}
		})
	}
}
