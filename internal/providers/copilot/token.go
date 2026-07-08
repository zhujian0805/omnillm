package copilot

import (
	"encoding/json"
	"fmt"
	"time"

	"omnillm/internal/database"
	ghservice "omnillm/internal/services/github"

	"github.com/rs/zerolog/log"
)

// SetGitHubToken sets the long-lived GitHub OAuth token (used for Copilot token refresh)
func (p *GitHubCopilotProvider) SetGitHubToken(token string) {
	p.mu.Lock()
	p.githubToken = token
	p.mu.Unlock()
}

// GetToken returns a valid short-lived Copilot API token, refreshing it when it
// is missing or within 5 minutes of expiry.
//
// The common case (valid token) takes only a read lock and returns immediately.
// When a refresh is needed, all concurrent callers funnel through a
// singleflight group so exactly one upstream token exchange happens even under
// heavy concurrent load; the others wait for and share its result.
func (p *GitHubCopilotProvider) GetToken() string {
	p.mu.RLock()
	token := p.token
	expiresAt := p.expiresAt
	hasGitHub := p.githubToken != ""
	p.mu.RUnlock()

	if !hasGitHub {
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

	// singleflight collapses the thundering herd: only one goroutine runs the
	// refresh; the rest block here and receive the same outcome.
	_, _, _ = p.refreshGroup.Do("refresh", func() (interface{}, error) {
		// Re-check under the group: a prior holder may have just refreshed.
		p.mu.RLock()
		fresh := p.token != "" && p.expiresAt != 0 && time.Now().Unix() <= p.expiresAt-300
		p.mu.RUnlock()
		if fresh {
			return nil, nil
		}
		if err := p.RefreshToken(); err != nil {
			log.Warn().Err(err).Msg("Failed to auto-refresh Copilot token")
		}
		return nil, nil
	})

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

// RefreshToken exchanges the long-lived GitHub OAuth token for a fresh
// short-lived Copilot API token and stores it. Safe for concurrent use.
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

	copilotToken, err := fetcher(githubToken)
	if err != nil {
		return fmt.Errorf("failed to refresh Copilot token: %w", err)
	}

	p.mu.Lock()
	p.token = copilotToken.Token
	p.expiresAt = copilotToken.ExpiresAt
	p.mu.Unlock()

	log.Info().Str("provider", instanceID).Msg("Copilot token refreshed")
	return nil
}

// LoadFromDB loads saved tokens from the database
func (p *GitHubCopilotProvider) LoadFromDB() error {
	p.mu.RLock()
	instanceID := p.instanceID
	p.mu.RUnlock()

	tokenStore := database.NewTokenStore()
	record, err := tokenStore.Get(instanceID)
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

	p.mu.Lock()
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
	needsRefresh := p.githubToken != "" && (p.token == "" || time.Now().Unix() > p.expiresAt-300)
	hasToken := p.token != ""
	p.mu.Unlock()

	// If we have a GitHub token, refresh the Copilot token if expired
	if needsRefresh {
		if err := p.RefreshToken(); err != nil {
			log.Warn().Err(err).Str("provider", instanceID).Msg("Failed to refresh token on load")
		}
	}

	if hasToken {
		log.Info().Str("provider", instanceID).Msg("Loaded saved token")
	}

	return nil
}

// SaveToDB saves the GitHub OAuth token and Copilot API token to database
func (p *GitHubCopilotProvider) SaveToDB() error {
	p.mu.RLock()
	instanceID := p.instanceID
	tokenData := map[string]interface{}{
		"github_token":  p.githubToken,
		"copilot_token": p.token,
		"expires_at":    p.expiresAt,
		"name":          p.name,
	}
	p.mu.RUnlock()

	tokenStore := database.NewTokenStore()
	return tokenStore.Save(instanceID, tokenData)
}
