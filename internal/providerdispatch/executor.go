package providerdispatch

import (
	"context"
	"fmt"
	"strings"

	"omnillm/internal/cif"
	"omnillm/internal/providers/shared"
	"omnillm/internal/providers/types"
)

type upstreamAPIReporter interface {
	UpstreamAPI(request *cif.CanonicalRequest, model string) string
}

type Candidate struct {
	Provider       types.Provider
	Adapter        types.ProviderAdapter
	Request        *cif.CanonicalRequest
	CanonicalModel string
	UpstreamModel  string
	UpstreamAPI    string
}

type PrepareFunc func(provider types.Provider, request *cif.CanonicalRequest)
type FallbackFunc func(request *cif.CanonicalRequest) bool

type Executor struct {
	PrepareRequest     PrepareFunc
	DefaultUpstreamAPI func(providerID, model string) string
}

func NewExecutor(prepare PrepareFunc, defaultUpstreamAPI func(providerID, model string) string) *Executor {
	return &Executor{
		PrepareRequest:     prepare,
		DefaultUpstreamAPI: defaultUpstreamAPI,
	}
}

func (e *Executor) BuildCandidate(provider types.Provider, request *cif.CanonicalRequest) (*Candidate, error) {
	if provider == nil {
		return nil, fmt.Errorf("provider is nil")
	}
	adapter := provider.GetAdapter()
	if adapter == nil {
		return nil, fmt.Errorf("provider %q has no adapter", provider.GetInstanceID())
	}

	providerRequest := *request
	if e.PrepareRequest != nil {
		e.PrepareRequest(provider, &providerRequest)
	}

	canonicalModel := providerRequest.Model
	upstreamModel := adapter.RemapModel(providerRequest.Model)
	providerRequest.Model = upstreamModel

	return &Candidate{
		Provider:       provider,
		Adapter:        adapter,
		Request:        &providerRequest,
		CanonicalModel: canonicalModel,
		UpstreamModel:  upstreamModel,
		UpstreamAPI:    e.detectUpstreamAPI(provider.GetID(), adapter, &providerRequest, upstreamModel),
	}, nil
}

func (e *Executor) Execute(ctx context.Context, candidate *Candidate) (*cif.CanonicalResponse, error) {
	response, err := candidate.Adapter.Execute(ctx, candidate.Request)
	if err != nil {
		return nil, fmt.Errorf("adapter execute failed: %w", err)
	}
	return response, nil
}

func (e *Executor) ExecuteStream(ctx context.Context, candidate *Candidate) (<-chan cif.CIFStreamEvent, error) {
	eventCh, err := candidate.Adapter.ExecuteStream(ctx, candidate.Request)
	if err != nil {
		return nil, err
	}
	return eventCh, nil
}

func (e *Executor) detectUpstreamAPI(providerID string, adapter types.ProviderAdapter, request *cif.CanonicalRequest, model string) string {
	if reporter, ok := adapter.(upstreamAPIReporter); ok {
		return reporter.UpstreamAPI(request, model)
	}
	if e.DefaultUpstreamAPI != nil {
		return e.DefaultUpstreamAPI(providerID, model)
	}
	return "chat.completions"
}

func DefaultUpstreamAPI(providerID, model string) string {
	if providerID == "azure-openai" && strings.Contains(strings.ToLower(model), "gpt-5.4") {
		return "responses"
	}
	return "chat.completions"
}

func ApplyGitHubCopilotSingleUpstreamMode(provider types.Provider, request *cif.CanonicalRequest) {
	if provider == nil || request == nil || provider.GetID() != string(types.ProviderGitHubCopilot) {
		return
	}

	if request.Extensions == nil {
		request.Extensions = &cif.Extensions{}
	}

	trueValue := true
	if !shouldForceChatCompletions(provider, request) {
		// Leave ForceChatCompletions unset so the Copilot adapter's
		// selectShape can pick /responses for responses-only models
		// (e.g. MAI-Code-1-Flash) and for inbound /v1/responses calls.
	} else {
		request.Extensions.ForceChatCompletions = &trueValue
	}
	request.Extensions.DisableAuthRetry = &trueValue
	request.Extensions.DisableStreamingFallback = &trueValue
}

// copilotResponsesOnlyChecker is satisfied by *copilot.GitHubCopilotProvider.
// Declared here (rather than imported) to avoid an import cycle:
// providerdispatch is consumed by the copilot package's transitive deps.
type copilotResponsesOnlyChecker interface {
	IsResponsesOnlyModel(model string) bool
}

// shouldForceChatCompletions decides whether to set ForceChatCompletions=true
// for a GitHub Copilot request. The historical behaviour was "true for every
// non-GPT-5 model", which broke responses-only models like MAI-Code-1-Flash
// and any inbound /v1/responses call routed through Copilot.
//
// Returns false when ANY of:
//   - The inbound API shape is "responses" — caller explicitly asked for the
//     Responses API, honour it.
//   - The Copilot provider's model catalog marks the model responses-only
//     (supported_endpoints contains /responses but not /chat/completions).
//   - The model is in the GPT-5 family (existing behaviour: those models
//     prefer /responses and have their own shape-selection logic).
//
// Returns true otherwise, preserving the legacy single-upstream-mode default
// for chat-completions-friendly models.
func shouldForceChatCompletions(provider types.Provider, request *cif.CanonicalRequest) bool {
	if request.Extensions != nil && request.Extensions.InboundAPIShape != nil {
		if strings.EqualFold(strings.TrimSpace(*request.Extensions.InboundAPIShape), "responses") {
			return false
		}
	}

	if checker, ok := provider.(copilotResponsesOnlyChecker); ok {
		if checker.IsResponsesOnlyModel(request.Model) {
			return false
		}
	}

	if shared.IsGPT5Family(request.Model) {
		return false
	}

	return true
}
