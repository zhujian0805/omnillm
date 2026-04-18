// Package alibaba provides Alibaba DashScope / Qwen provider implementation.
// This package contains auth, header, model, and adapter logic specific to Alibaba.
package alibaba

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"omnimodel/internal/cif"
	"omnimodel/internal/database"
	"omnimodel/internal/providers/shared"
	"omnimodel/internal/providers/types"

	"github.com/rs/zerolog/log"
)

const UserAgent = "QwenCode/0.13.2 (darwin; arm64)"

// API mode constants
const (
	AlibabaAPIModeOpenAICompatible = "openai-compatible"
	AlibabaAPIModeAnthropic        = "anthropic"
	AlibabaAPIModeCodingPlan       = "coding-plan"
)

// AnthropicBaseURL is the DashScope endpoint that speaks the Anthropic Messages API.
const AnthropicBaseURL = "https://dashscope.aliyuncs.com/apps/anthropic/v1"

// Model catalog for Alibaba DashScope.
var Models = []types.Model{
	{ID: "qwen3.6-plus", Name: "Qwen3.6 Plus", MaxTokens: 131072, Provider: "alibaba"},
	{ID: "qwen3.5-omni-flash", Name: "Qwen3.5 Omni Flash", MaxTokens: 131072, Provider: "alibaba"},
	{ID: "qwen3-coder-next", Name: "Qwen3 Coder Next", MaxTokens: 131072, Provider: "alibaba"},
	{ID: "qwen3-coder-plus", Name: "Qwen3 Coder Plus", MaxTokens: 131072, Provider: "alibaba"},
	{ID: "qwen3-coder-flash", Name: "Qwen3 Coder Flash", MaxTokens: 131072, Provider: "alibaba"},
	{ID: "qwen3-max", Name: "Qwen3 Max", MaxTokens: 32768, Provider: "alibaba"},
	{ID: "qwen3-max-preview", Name: "Qwen3 Max Preview", MaxTokens: 32768, Provider: "alibaba"},
	{ID: "qwen3-32b", Name: "Qwen3-32B", MaxTokens: 131072, Provider: "alibaba"},
	{ID: "qwen3-235b-a22b-instruct", Name: "Qwen3-235B-A22B Instruct", MaxTokens: 131072, Provider: "alibaba"},
	{ID: "qwen-plus", Name: "Qwen Plus", MaxTokens: 131072, Provider: "alibaba"},
	{ID: "qwen-turbo", Name: "Qwen Turbo", MaxTokens: 1000000, Provider: "alibaba"},
}

// OAuthSupportedModels is the set of model IDs available to OAuth (portal.qwen.ai) users.
var OAuthSupportedModels = map[string]bool{
	"qwen3.6-plus":             true,
	"qwen3-coder-next":         true,
	"qwen3-coder-plus":         true,
	"qwen3-coder-flash":        true,
	"qwen3-max":                true,
	"qwen3-max-preview":        true,
	"qwen3-32b":                true,
	"qwen3-235b-a22b-instruct": true,
}

// AnthropicModels lists Claude models served via the DashScope Anthropic-compatible endpoint.
var AnthropicModels = []types.Model{
	{ID: "claude-opus-4.5", Name: "Claude Opus 4.5", MaxTokens: 32768, Provider: "alibaba"},
	{ID: "claude-sonnet-4.5", Name: "Claude Sonnet 4.5", MaxTokens: 200000, Provider: "alibaba"},
	{ID: "claude-haiku-4.5", Name: "Claude Haiku 4.5", MaxTokens: 200000, Provider: "alibaba"},
}


// ─── Auth ─────────────────────────────────────────────────────────────────────

// SetupAPIKeyAuth handles the api-key auth method for Alibaba.
// It saves the token and config to the database and updates the in-memory fields.
func SetupAPIKeyAuth(instanceID string, options *types.AuthOptions) (token, baseURL, name string, config map[string]interface{}, err error) {
	if options.APIKey == "" {
		return "", "", "", nil, fmt.Errorf("alibaba: API key is required")
	}

	// Anthropic-compatible mode: completely different routing, no plan/region.
	if strings.ToLower(strings.TrimSpace(options.APIFormat)) == "anthropic" {
		cfg := map[string]interface{}{"api_format": "anthropic"}
		if endpoint := strings.TrimSpace(options.Endpoint); endpoint != "" {
			cfg["base_url"] = endpoint
		}

		tokenStore := database.NewTokenStore()
		tokenData := map[string]interface{}{"access_token": options.APIKey}
		if err := tokenStore.Save(instanceID, "alibaba", tokenData); err != nil {
			return "", "", "", nil, fmt.Errorf("failed to save alibaba token: %w", err)
		}
		configStore := database.NewProviderConfigStore()
		if err := configStore.Save(instanceID, cfg); err != nil {
			return "", "", "", nil, fmt.Errorf("failed to save alibaba config: %w", err)
		}

		resolvedURL := NormalizeBaseURL(cfg)
		return options.APIKey, resolvedURL, "Alibaba Anthropic API", cfg, nil
	}

	region := strings.TrimSpace(options.Region)
	if region == "" {
		region = "global"
	}
	plan := NormalizeAPIPlan(options.Plan)

	tokenStore := database.NewTokenStore()
	tokenData := map[string]interface{}{"access_token": options.APIKey}
	if err := tokenStore.Save(instanceID, "alibaba", tokenData); err != nil {
		return "", "", "", nil, fmt.Errorf("failed to save alibaba token: %w", err)
	}

	cfg := map[string]interface{}{
		"auth_type": "api-key",
		"region":    region,
		"plan":      plan,
	}
	if endpoint := strings.TrimSpace(options.Endpoint); endpoint != "" {
		cfg["base_url"] = endpoint
	}

	configStore := database.NewProviderConfigStore()
	if err := configStore.Save(instanceID, cfg); err != nil {
		return "", "", "", nil, fmt.Errorf("failed to save alibaba config: %w", err)
	}

	resolvedURL := NormalizeBaseURL(cfg)
	resolvedName := APIKeyProviderName(cfg)

	log.Info().
		Str("provider", instanceID).
		Str("region", region).
		Str("plan", plan).
		Msg("Alibaba authenticated via API key")

	return options.APIKey, resolvedURL, resolvedName, cfg, nil
}

// LoadTokenFromDB reads the persisted Alibaba token from the database.
// Returns the token string, base URL, config, and any error.
func LoadTokenFromDB(instanceID string) (token, baseURL string, config map[string]interface{}, err error) {
	tokenStore := database.NewTokenStore()
	record, err := tokenStore.Get(instanceID)
	if err != nil {
		return "", "", nil, fmt.Errorf("alibaba: failed to load token from DB: %w", err)
	}
	if record == nil {
		return "", "", nil, nil
	}

	var td TokenData
	if err := json.Unmarshal([]byte(record.TokenData), &td); err != nil {
		return "", "", nil, fmt.Errorf("alibaba: failed to parse token data: %w", err)
	}

	cfg := map[string]interface{}{
		"auth_type": td.AuthType,
		"base_url":  td.BaseURL,
	}
	resolvedURL := NormalizeBaseURL(cfg)
	return td.AccessToken, resolvedURL, cfg, nil
}

// EnsureFreshToken returns the current token since we only support API keys (no refresh needed)
func EnsureFreshToken(instanceID, currentToken string) string {
	return currentToken
}

// SaveOAuthToken is a stub that returns an error since OAuth is no longer supported
func SaveOAuthToken(instanceID string, td *TokenData) (newInstanceID, name, baseURL string, err error) {
	return "", "", "", fmt.Errorf("oauth authentication is no longer supported for Alibaba DashScope - please use API key authentication")
}


// ─── Headers ──────────────────────────────────────────────────────────────────

// Headers returns the HTTP headers required for Alibaba API requests.
// When stream is true, Accept is set to text/event-stream.
// OAuth auth_type adds DashScope-specific headers and User-Agent.
func Headers(token string, stream bool, config map[string]interface{}) map[string]string {
	headers := map[string]string{
		"Authorization": "Bearer " + token,
		"Content-Type":  "application/json",
		"Accept":        "application/json",
	}

	if config != nil {
		if authType, ok := config["auth_type"].(string); ok && strings.ToLower(authType) == "oauth" {
			headers["User-Agent"] = UserAgent
			headers["X-DashScope-AuthType"] = "qwen-oauth"
			headers["X-DashScope-CacheControl"] = "enable"
		}
	}

	if stream {
		headers["Accept"] = "text/event-stream"
	}
	return headers
}

// ChatURL returns the chat completions URL for the given base URL.
func ChatURL(baseURL string) string {
	base := baseURL
	if base == "" {
		base = BaseURLGlobal
	}
	return base + "/chat/completions"
}

// ─── Models ───────────────────────────────────────────────────────────────────

// RemapModel maps Claude model IDs to their Qwen equivalents for Anthropic mode,
// and returns all other model IDs unchanged.
func RemapModel(modelID string) string {
	m := strings.TrimSpace(modelID)
	lower := strings.ToLower(m)
	switch {
	case strings.HasPrefix(lower, "claude-opus"):
		return "qwen3-max"
	case strings.HasPrefix(lower, "claude-sonnet"):
		return "qwen3.6-plus"
	case strings.HasPrefix(lower, "claude-haiku"):
		return "qwen3-coder-flash"
	default:
		return m
	}
}

// GetModels returns the available models for this Alibaba instance.
// For Anthropic mode it returns the fixed Claude catalog.
// For API-key authentication it tries live discovery then falls back to the hardcoded catalog.
func GetModels(instanceID, token, baseURL string, config map[string]interface{}) (*types.ModelsResponse, error) {
	if token == "" {
		return nil, fmt.Errorf("alibaba: not authenticated (set access_token via admin UI)")
	}

	if IsAnthropicMode(config) {
		return GetModelsAnthropicMode(instanceID), nil
	}

	resp, err := FetchModelsFromAPI(instanceID, token, baseURL, config)
	if err == nil && len(resp.Data) > 0 {
		return resp, nil
	}

	log.Warn().Err(err).Str("provider", instanceID).Msg("Failed to fetch models from API, using hardcoded list")
	return GetModelsHardcoded(instanceID, config), nil
}

// GetModelsHardcoded returns the hardcoded model catalog for this Alibaba instance.
// OAuth users receive only the subset listed in OAuthSupportedModels.
func GetModelsHardcoded(instanceID string, config map[string]interface{}) *types.ModelsResponse {
	var source []types.Model
	if isOAuth(config) {
		for _, m := range Models {
			if OAuthSupportedModels[m.ID] {
				source = append(source, m)
			}
		}
	} else {
		source = Models
	}
	if source == nil {
		source = []types.Model{}
	}
	result := make([]types.Model, len(source))
	for i, m := range source {
		result[i] = m
		result[i].Provider = instanceID
	}
	return &types.ModelsResponse{Data: result, Object: "list"}
}

// GetModelsAnthropicMode returns the Claude model catalog for Anthropic-compatible mode.
func GetModelsAnthropicMode(instanceID string) *types.ModelsResponse {
	result := make([]types.Model, len(AnthropicModels))
	for i, m := range AnthropicModels {
		result[i] = m
		result[i].Provider = instanceID
	}
	return &types.ModelsResponse{Data: result, Object: "list"}
}

// isOAuth returns true when the config indicates oauth auth_type.
func isOAuth(config map[string]interface{}) bool {
	if config == nil {
		return false
	}
	authType, _ := config["auth_type"].(string)
	return strings.ToLower(authType) == "oauth"
}

// FetchModelsFromAPI fetches available models from the Alibaba DashScope API.
func FetchModelsFromAPI(instanceID, token, baseURL string, config map[string]interface{}) (*types.ModelsResponse, error) {
	url := strings.TrimRight(baseURL, "/") + "/models"
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create alibaba models request: %w", err)
	}

	for key, value := range Headers(token, false, map[string]interface{}{}) {
		req.Header.Set(key, value)
	}

	client := alibabaHTTPClient
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("alibaba models request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("alibaba models fetch failed (%d)", resp.StatusCode)
	}

	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("failed to decode alibaba models response: %w", err)
	}

	models := make([]types.Model, 0, len(payload.Data))
	for _, model := range payload.Data {
		if model.ID == "" {
			continue
		}
		if !IsChatCompletionsModel(model.ID) {
			continue
		}
		result := types.Model{
			ID:       model.ID,
			Name:     model.ID,
			Provider: instanceID,
		}
		if metadata, ok := ModelMetadata(model.ID); ok {
			if metadata.Name != "" {
				result.Name = metadata.Name
			}
			result.Description = metadata.Description
			result.Capabilities = metadata.Capabilities
			result.MaxTokens = metadata.MaxTokens
		}
		models = append(models, result)
	}
	return &types.ModelsResponse{Data: models, Object: "list"}, nil
}

// IsChatCompletionsModel returns true if the model supports chat completions
// (i.e., is not a realtime-only model).
func IsChatCompletionsModel(modelID string) bool {
	return !strings.Contains(strings.ToLower(modelID), "realtime")
}

// IsReasoningModel returns true if the model ID is a known Qwen reasoning model
// (Qwen3/Qwen3.5/Qwen3.6/QwQ/Qwen-Plus family) that supports the enable_thinking flag
// on the DashScope China endpoint.
func IsReasoningModel(modelID string) bool {
	lower := strings.ToLower(modelID)
	return strings.Contains(lower, "qwen3") ||
		strings.Contains(lower, "qwq") ||
		strings.Contains(lower, "qwen-plus") ||
		strings.Contains(lower, "qwen3.5") ||
		strings.Contains(lower, "qwen3.6")
}

// ModelMetadata returns the hardcoded metadata for the given model ID if known.
func ModelMetadata(modelID string) (types.Model, bool) {
	for _, m := range Models {
		if m.ID == modelID {
			return m, true
		}
	}
	return types.Model{}, false
}


// ─── URL helpers ──────────────────────────────────────────────────────────────

// NormalizeBaseURL derives the base URL from a provider config map.
func NormalizeBaseURL(config map[string]interface{}) string {
	// Anthropic mode: explicit base_url wins, otherwise the Anthropic endpoint.
	if IsAnthropicMode(config) {
		if baseURL, ok := shared.FirstString(config, "base_url", "baseUrl"); ok {
			return EnsureBaseURL(baseURL, false)
		}
		return AnthropicBaseURL
	}

	// OAuth mode: resource_url or base_url wins, otherwise the portal URL.
	if isOAuth(config) {
		if baseURL, ok := shared.FirstString(config, "resource_url", "base_url", "baseUrl"); ok {
			return EnsureBaseURL(baseURL, true)
		}
		return EnsureBaseURL("", true)
	}

	if baseURL, ok := shared.FirstString(config, "base_url", "baseUrl"); ok {
		return EnsureBaseURL(baseURL, false)
	}
	plan, _ := shared.FirstString(config, "plan")
	region, _ := shared.FirstString(config, "region")
	return DefaultAPIBaseURL(plan, region)
}

// NormalizeAPIPlan normalizes a plan string to "coding-plan" or "standard".
func NormalizeAPIPlan(plan string) string {
	switch strings.ToLower(strings.TrimSpace(plan)) {
	case "coding", "coding-plan", "coding_plan":
		return "coding-plan"
	default:
		return "standard"
	}
}

// DefaultAPIBaseURL returns the default DashScope base URL for the given plan and region.
func DefaultAPIBaseURL(plan, region string) string {
	switch NormalizeAPIPlan(plan) {
	case "coding-plan":
		if strings.EqualFold(strings.TrimSpace(region), "china") {
			return CodingPlanBaseURLChina
		}
		return CodingPlanBaseURLGlobal
	default:
		if strings.EqualFold(strings.TrimSpace(region), "china") {
			return BaseURLChina
		}
		return BaseURLGlobal
	}
}

// APIKeyProviderName returns the display name for an API-key authenticated Alibaba provider.
func APIKeyProviderName(config map[string]interface{}) string {
	if IsAnthropicMode(config) {
		return "Alibaba Anthropic API"
	}
	region, _ := shared.FirstString(config, "region")
	if region == "" {
		region = "global"
	}
	planRaw, _ := config["plan"].(string)
	switch NormalizeAPIPlan(planRaw) {
	case "coding-plan":
		return "Alibaba Coding Plan (" + region + ")"
	default:
		return "Alibaba DashScope Standard (" + region + ")"
	}
}

// IsAnthropicMode returns true when the config specifies api_format=anthropic.
func IsAnthropicMode(config map[string]interface{}) bool {
	if config == nil {
		return false
	}
	format, _ := shared.FirstString(config, "api_format", "apiFormat")
	return strings.ToLower(format) == "anthropic"
}

// AlibabaAPIMode returns the API mode string for the given config.
func AlibabaAPIMode(config map[string]interface{}) string {
	if IsAnthropicMode(config) {
		return AlibabaAPIModeAnthropic
	}
	plan, _ := shared.FirstString(config, "plan")
	if NormalizeAPIPlan(plan) == "coding-plan" {
		return AlibabaAPIModeCodingPlan
	}
	return AlibabaAPIModeOpenAICompatible
}

// AnthropicMessagesURL returns the Anthropic Messages API endpoint for the given base URL.
func AnthropicMessagesURL(baseURL string) string {
	base := strings.TrimSpace(baseURL)
	if base == "" {
		base = AnthropicBaseURL
	}
	return strings.TrimRight(base, "/") + "/messages"
}

// EnsureBaseURL normalizes a base URL to have https scheme and /v1 suffix.
// When forOAuth is true and raw is empty, the Qwen portal URL is returned.
func EnsureBaseURL(raw string, forOAuth bool) string {
	baseURL := strings.TrimSpace(raw)
	if baseURL == "" {
		if forOAuth {
			return "https://portal.qwen.ai/v1"
		}
		baseURL = BaseURLGlobal
	}
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "https://" + baseURL
	}
	baseURL = strings.TrimRight(baseURL, "/")
	if !strings.HasSuffix(baseURL, "/v1") {
		baseURL += "/v1"
	}
	return baseURL
}



// BuildOpenAIPayload builds the OpenAI-compatible request payload for Alibaba DashScope.
// forVision is reserved for future multimodal routing. enableThinking controls the
// DashScope enable_thinking flag for Qwen3 reasoning models; it is suppressed when
// real tools are present because DashScope rejects that combination.
func BuildOpenAIPayload(model string, messages []map[string]interface{}, request *cif.CanonicalRequest, forVision bool, enableThinking bool) map[string]interface{} {
	payload := map[string]interface{}{
		"model":    model,
		"messages": messages,
	}

	// Apply sampling parameters; use LiteLLM-style defaults when nil.
	if request.Temperature != nil {
		payload["temperature"] = *request.Temperature
	} else {
		payload["temperature"] = 0.55
	}
	if request.TopP != nil {
		payload["top_p"] = *request.TopP
	} else {
		payload["top_p"] = 1.0
	}
	if request.MaxTokens != nil {
		payload["max_tokens"] = *request.MaxTokens
	}
	if len(request.Stop) > 0 {
		payload["stop"] = request.Stop
	}
	if request.UserID != nil {
		payload["user"] = *request.UserID
	}

	if len(request.Tools) > 0 {
		tools := make([]map[string]interface{}, 0, len(request.Tools))
		for _, tool := range request.Tools {
			t := map[string]interface{}{
				"type": "function",
				"function": map[string]interface{}{
					"name":       tool.Name,
					"parameters": shared.NormalizeToolParameters(tool.ParametersSchema),
				},
			}
			if tool.Description != nil {
				t["function"].(map[string]interface{})["description"] = *tool.Description
			}
			tools = append(tools, t)
		}
		payload["tools"] = tools
	}

	if request.ToolChoice != nil {
		if toolChoice := shared.ConvertCanonicalToolChoiceToOpenAI(request.ToolChoice); toolChoice != nil {
			payload["tool_choice"] = toolChoice
		}
	}

	// enable_thinking must be absent when real tools are present: DashScope rejects
	// thinking_budget=0 and enable_thinking=true suppresses tool_calls SSE deltas.
	if enableThinking && IsReasoningModel(model) && len(request.Tools) == 0 {
		payload["enable_thinking"] = true
	}

	return payload
}

// EnsureOAuthSystemMessage ensures the Qwen Code system prompt is present as the
// first message. If no system message exists one is injected. If one already exists,
// the Qwen Code header is prepended (deduplication prevents double-prepending).
func EnsureOAuthSystemMessage(messages []map[string]interface{}) []map[string]interface{} {
	const header = "You are Qwen Code."

	// Find first system message index.
	sysIdx := -1
	for i, m := range messages {
		if role, _ := m["role"].(string); role == "system" {
			sysIdx = i
			break
		}
	}

	if sysIdx == -1 {
		// No system message — inject one at the front.
		injected := map[string]interface{}{"role": "system", "content": header}
		return append([]map[string]interface{}{injected}, messages...)
	}

	existing, _ := messages[sysIdx]["content"].(string)
	if strings.HasPrefix(existing, header) {
		// Already has the header — no change needed.
		return messages
	}

	// Prepend header to existing system message content.
	result := make([]map[string]interface{}, len(messages))
	copy(result, messages)
	updated := make(map[string]interface{})
	for k, v := range messages[sysIdx] {
		updated[k] = v
	}
	if existing == "" {
		updated["content"] = header
	} else {
		updated["content"] = header + "\n\n" + existing
	}
	result[sysIdx] = updated
	return result
}
