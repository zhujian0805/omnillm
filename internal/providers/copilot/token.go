package copilot

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"omnillm/internal/database"
	ghservice "omnillm/internal/services/github"

	"github.com/rs/zerolog/log"
)

// SetGitHubToken sets the long-lived GitHub OAuth token (used for Copilot token refresh)
func (p *GitHubCopilotProvider) SetGitHubToken(token string) {
	p.githubToken = token
}

func (p *GitHubCopilotProvider) GetToken() string {
	p.mu.RLock()
	githubToken := p.githubToken
	token := p.token
	expiresAt := p.expiresAt
	p.mu.RUnlock()

	if githubToken == "" {
		return token
	}

	needsRefresh := token == "" || expiresAt == 0 || time.Now().Unix() > expiresAt-300
	if !needsRefresh {
		return token
	}

	var refreshStart time.Time
	if debugEnabled() {
		refreshStart = time.Now()
	}
	if err := p.RefreshToken(); err != nil {
		log.Warn().Err(err).Msg("Failed to auto-refresh Copilot token")
	}
	if debugEnabled() {
		log.Debug().
			Str("provider", p.instanceID).
			Bool("needs_refresh", needsRefresh).
			Int64("elapsed_ms", time.Since(refreshStart).Milliseconds()).
			Msg("Copilot GetToken refresh path")
	}

	p.mu.RLock()
	token = p.token
	p.mu.RUnlock()
	return token
}

func (p *GitHubCopilotProvider) RefreshToken() error {
	p.mu.RLock()
	githubToken := p.githubToken
	fetcher := p.tokenFetcher
	instanceID := p.instanceID
	p.mu.RUnlock()

	if githubToken == "" {
		log.Debug().Str("provider", instanceID).Msg("No GitHub token available for refresh")
		return nil
	}
	if fetcher == nil {
		fetcher = ghservice.GetCopilotToken
	}

	// Collapse concurrent refreshes into a single upstream exchange
	// (thundering-herd protection): when many requests find the token expired
	// at once, only one performs the exchange and the rest wait for its result.
	_, err, _ := p.refreshGroup.Do(instanceID, func() (interface{}, error) {
		copilotToken, err := fetcher(githubToken)
		if err != nil {
			return nil, fmt.Errorf("failed to refresh Copilot token: %w", err)
		}

		// Enterprise Copilot seats serve from an account-specific API host
		// (e.g. https://api.enterprise.githubcopilot.com) advertised in the
		// token exchange's endpoints.api field. Personal seats return the
		// public host. Adopt whatever the exchange reports so enterprise seats
		// route correctly instead of hitting the hardcoded public host and
		// failing every request.
		p.mu.Lock()
		p.token = copilotToken.Token
		p.expiresAt = copilotToken.ExpiresAt
		oldBaseURL := p.baseURL
		newBaseURL := oldBaseURL
		if api := strings.TrimSpace(copilotToken.Endpoints.API); api != "" && api != oldBaseURL {
			p.baseURL = api
			newBaseURL = api
		}
		p.mu.Unlock()

		if newBaseURL != oldBaseURL {
			log.Info().
				Str("provider", instanceID).
				Str("old_base_url", oldBaseURL).
				Str("new_base_url", newBaseURL).
				Msg("Copilot upstream API host updated from token exchange")
		}

		log.Info().Str("provider", instanceID).Msg("Copilot token refreshed")
		return nil, nil
	})
	return err
}

// LoadFromDB loads saved tokens from the database
func (p *GitHubCopilotProvider) LoadFromDB() error {
	tokenStore := database.NewTokenStore()
	record, err := tokenStore.Get(p.instanceID)
	if err != nil {
		return fmt.Errorf("failed to load token: %w", err)
	}
	if record == nil {
		return nil // no saved token
	}

	var tokenData map[string]interface{}
	if err := json.Unmarshal([]byte(record.TokenData), &tokenData); err != nil {
		return fmt.Errorf("failed to parse token data: %w", err)
	}

	if gt, ok := tokenData["github_token"].(string); ok {
		p.githubToken = gt
	}
	if ct, ok := tokenData["copilot_token"].(string); ok {
		p.token = ct
	}
	if ea, ok := tokenData["expires_at"].(float64); ok {
		p.expiresAt = int64(ea)
	}
	if p.name == "" {
		if name, ok := tokenData["name"].(string); ok && name != "" {
			p.name = name
		}
	}

	// If we have a GitHub token, refresh the Copilot token if expired
	if p.githubToken != "" && (p.token == "" || time.Now().Unix() > p.expiresAt-300) {
		if err := p.RefreshToken(); err != nil {
			log.Warn().Err(err).Str("provider", p.instanceID).Msg("Failed to refresh token on load")
		}
	}

	if p.token != "" {
		log.Info().Str("provider", p.instanceID).Msg("Loaded saved token")
	}

	return nil
}

// SaveToDB saves the GitHub OAuth token and Copilot API token to database
func (p *GitHubCopilotProvider) SaveToDB() error {
	tokenStore := database.NewTokenStore()
	tokenData := map[string]interface{}{
		"github_token":  p.githubToken,
		"copilot_token": p.token,
		"expires_at":    p.expiresAt,
		"name":          p.name,
	}

	return tokenStore.Save(p.instanceID, tokenData)
}
