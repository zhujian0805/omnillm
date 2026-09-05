package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"omnillm/internal/lib/catalogcache"
	"omnillm/internal/lib/catalogstate"
	"omnillm/internal/providers/shared"
	"omnillm/internal/providers/types"
	"omnillm/internal/services/modelsmeta"
)

// modelsCacheTTL is how long a successful live catalog fetch is reused before
// the next request re-queries upstream. The catalog changes on the order of
// weeks, so a short TTL costs nothing while keeping a stale list from
// outliving a model rollout.
const modelsCacheTTL = 15 * time.Minute

// modelsClientVersion is sent as the required `client_version` query parameter
// on /models. The backend gates the catalog on it: each model carries a
// `minimal_client_version`, and entries above the value we send are omitted
// from the response entirely. Sending a deliberately high version therefore
// returns the full catalog the account can reach, rather than the subset an
// older Codex CLI would see.
const modelsClientVersion = "99.0.0"

// modelsHTTPClient is a non-streaming client for the /models probe.
var modelsHTTPClient = &http.Client{
	Timeout:   30 * time.Second,
	Transport: shared.DefaultHTTPTransport(),
}

// The provider owns freshness so routing and remapping see the same snapshot.
var modelCatalogCache = catalogcache.New(modelsCacheTTL, time.Hour)

func FetchModels(p *Provider) *types.ModelsResponse {
	if p == nil {
		return GetModels("")
	}
	// Complete token rotation before capturing the catalog lifecycle version.
	p.GetToken()
	response, err := modelCatalogCache.Get(p.GetInstanceID(), p.GetID(), func() (*types.ModelsResponse, error) {
		models, err := fetchModelsLive(p)
		if err != nil {
			return nil, err
		}
		return &types.ModelsResponse{Data: models, Object: "list", Source: "live"}, nil
	})
	if err == nil && response != nil {
		return response
	}
	log.Debug().Str("provider", p.GetInstanceID()).Msg("OpenAI model discovery unavailable; using degraded built-in catalog")
	response = GetModels(p.GetInstanceID())
	response.Degraded = true
	response.Source = "built-in"
	return response
}

func InvalidateModelsCache(instanceID string) { catalogstate.Invalidate(instanceID) }

func fetchModelsLive(p *Provider) ([]types.Model, error) {
	headers := p.GetHeaders(false)
	if strings.TrimSpace(strings.TrimPrefix(headers["Authorization"], "Bearer")) == "" {
		return nil, fmt.Errorf("openai: not authenticated")
	}

	req, err := http.NewRequest("GET", p.GetBaseURL()+"/models?client_version="+url.QueryEscape(modelsClientVersion), nil)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	// The catalog is plain JSON, unlike the SSE-only /responses endpoint.
	req.Header.Set("Accept", "application/json")

	resp, err := modelsHTTPClient.Do(req)
	if err != nil {
		return nil, &catalogcache.TransientError{}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			return nil, &catalogcache.TransientError{Status: resp.StatusCode}
		}
		return nil, fmt.Errorf("openai: models request returned %d", resp.StatusCode)
	}

	return parseModelsResponse(io.LimitReader(resp.Body, 1<<20), p.GetInstanceID())
}

// parseModelsResponse decodes a /models payload into the catalog type.
func parseModelsResponse(r io.Reader, instanceID string) ([]types.Model, error) {
	// The Codex backend returns {"models":[{"slug":…}]}, not the OpenAI
	// platform's {"data":[{"id":…}]}. Both shapes are accepted so the probe
	// keeps working if an instance is pointed at an api.openai.com-style base
	// URL.
	var payload struct {
		Models []codexModel `json:"models"`
		Data   []codexModel `json:"data"`
	}
	if err := json.NewDecoder(r).Decode(&payload); err != nil {
		return nil, fmt.Errorf("openai: decode models response: %w", err)
	}

	entries := payload.Models
	if len(entries) == 0 {
		entries = payload.Data
	}

	models := make([]types.Model, 0, len(entries))
	for _, m := range entries {
		id := strings.TrimSpace(firstNonEmpty(m.Slug, m.ID))
		if id == "" {
			continue
		}
		// The ChatGPT-account backend rejects *-codex IDs with "not supported
		// when using Codex with a ChatGPT account", so drop them even when
		// upstream advertises them.
		if strings.Contains(id, "codex") {
			continue
		}
		// Upstream marks internal/experimental entries as hidden; they are not
		// meant to be user-selectable.
		if m.Visibility != "" && m.Visibility != "list" {
			continue
		}
		model := types.Model{
			ID:           id,
			Name:         firstNonEmpty(m.DisplayName, m.Name, id),
			MaxTokens:    firstPositive(m.ContextWindow, m.MaxTokens, m.MaxOutput),
			OutputTokens: m.MaxOutput,
			Provider:     instanceID,
		}
		EnrichFromModelsDev(&model)
		if model.MaxTokens <= 0 {
			model.MaxTokens = defaultMaxTokens
		}
		models = append(models, model)
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("openai: models response contained no usable entries")
	}

	sort.Slice(models, func(i, j int) bool { return models[i].ID > models[j].ID })
	return models, nil
}

// codexModel is one entry of the /models catalog. The Codex backend keys
// models by `slug`; `id` is accepted for platform-style responses.
type codexModel struct {
	Slug          string `json:"slug"`
	ID            string `json:"id"`
	Name          string `json:"name"`
	DisplayName   string `json:"display_name"`
	Visibility    string `json:"visibility"`
	MaxTokens     int    `json:"max_tokens"`
	ContextWindow int    `json:"context_window"`
	MaxOutput     int    `json:"max_output_tokens"`
}

func firstPositive(values ...int) int {
	for _, v := range values {
		if v > 0 {
			return v
		}
	}
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// EnrichFromModelsDev fills in metadata (display name, context/output token
// limits, capability flags) for a catalog entry from models.dev. Values
// already reported by the upstream /models probe win; models.dev only fills
// gaps, so a live catalog is never overridden by third-party data.
func EnrichFromModelsDev(m *types.Model) {
	if m == nil || strings.TrimSpace(m.ID) == "" {
		return
	}
	meta := modelsmeta.DefaultService.LookupModel(context.Background(), m.ID)
	if meta == nil {
		return
	}

	if strings.TrimSpace(m.Name) == "" || m.Name == m.ID {
		if meta.Name != "" {
			m.Name = meta.Name
		}
	}
	if m.MaxTokens <= 0 && meta.ContextLimitTokens != nil {
		m.MaxTokens = *meta.ContextLimitTokens
	}
	if m.OutputTokens <= 0 && meta.OutputLimitTokens != nil {
		m.OutputTokens = *meta.OutputLimitTokens
	}

	if m.Capabilities == nil {
		m.Capabilities = map[string]interface{}{}
	}
	setCap := func(key string, val *bool) {
		if val == nil {
			return
		}
		if _, exists := m.Capabilities[key]; !exists {
			m.Capabilities[key] = *val
		}
	}
	setCap("tool_call", meta.SupportsToolCall)
	setCap("structured_output", meta.SupportsStructuredOutput)
	setCap("reasoning", meta.SupportsReasoning)
	setCap("attachments", meta.SupportsAttachments)
	if meta.KnowledgeCutoff != "" {
		if _, exists := m.Capabilities["knowledge_cutoff"]; !exists {
			m.Capabilities["knowledge_cutoff"] = meta.KnowledgeCutoff
		}
	}
	if meta.ReleaseDate != "" {
		if _, exists := m.Capabilities["release_date"]; !exists {
			m.Capabilities["release_date"] = meta.ReleaseDate
		}
	}
	if len(m.Capabilities) == 0 {
		m.Capabilities = nil
	}
}
