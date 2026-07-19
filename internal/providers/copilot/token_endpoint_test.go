package copilot

import (
	"testing"

	ghservice "omnillm/internal/services/github"
)

// TestRefreshToken_AdoptsEnterpriseEndpoint verifies that when the Copilot
// token exchange returns an account-specific api host (as GitHub Enterprise
// seats do), RefreshToken updates the provider baseURL so requests route to
// the correct upstream instead of the hardcoded public host.
func TestRefreshToken_AdoptsEnterpriseEndpoint(t *testing.T) {
	p := NewGitHubCopilotProvider("test-ent", "")
	p.SetGitHubToken("ghu_fake")
	p.tokenFetcher = func(string) (*ghservice.CopilotTokenResponse, error) {
		return &ghservice.CopilotTokenResponse{
			Token:     "copilot_tok",
			ExpiresAt: 9999999999,
			Endpoints: ghservice.CopilotEndpoints{
				API: "https://api.enterprise.githubcopilot.com",
			},
		}, nil
	}

	if err := p.RefreshToken(); err != nil {
		t.Fatalf("RefreshToken failed: %v", err)
	}
	if got, want := p.GetBaseURL(), "https://api.enterprise.githubcopilot.com"; got != want {
		t.Fatalf("baseURL = %q, want %q", got, want)
	}
	if p.token != "copilot_tok" {
		t.Fatalf("token = %q, want copilot_tok", p.token)
	}
}

// TestRefreshToken_KeepsPublicEndpointWhenEmpty verifies that a token exchange
// with no endpoints.api (personal seats / older responses) leaves the default
// public baseURL untouched.
func TestRefreshToken_KeepsPublicEndpointWhenEmpty(t *testing.T) {
	p := NewGitHubCopilotProvider("test-personal", "")
	p.SetGitHubToken("ghu_fake")
	p.tokenFetcher = func(string) (*ghservice.CopilotTokenResponse, error) {
		return &ghservice.CopilotTokenResponse{
			Token:     "copilot_tok",
			ExpiresAt: 9999999999,
		}, nil
	}

	if err := p.RefreshToken(); err != nil {
		t.Fatalf("RefreshToken failed: %v", err)
	}
	if got, want := p.GetBaseURL(), "https://api.githubcopilot.com"; got != want {
		t.Fatalf("baseURL = %q, want default public host %q", got, want)
	}
}
