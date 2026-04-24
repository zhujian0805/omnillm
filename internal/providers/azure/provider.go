package azure

import (
	"encoding/json"
	"fmt"
	"omnillm/internal/database"
	"omnillm/internal/providers/types"
	"strings"

	"github.com/rs/zerolog/log"
)

// SetupAuth handles API-key authentication for Azure OpenAI.
// Returns the token, endpoint, and config; or an error.
func SetupAuth(instanceID string, options *types.AuthOptions) (token, endpoint string, config map[string]interface{}, err error) {
	if options.APIKey == "" {
		return "", "", nil, fmt.Errorf("azure-openai: API key is required")
	}

	tokenStore := database.NewTokenStore()
	tokenData := map[string]interface{}{"access_token": options.APIKey}
	if err := tokenStore.Save(instanceID, "azure-openai", tokenData); err != nil {
		return "", "", nil, fmt.Errorf("failed to save azure token: %w", err)
	}

	cfg := map[string]interface{}{}
	resolvedEndpoint := ""
	if options.Endpoint != "" {
		cfg["endpoint"] = options.Endpoint
		resolvedEndpoint = strings.TrimRight(options.Endpoint, "/")
	}

	// Persist deployments if provided (JSON-encoded string)
	if options.Deployments != "" {
		var deployments []string
		if err := json.Unmarshal([]byte(options.Deployments), &deployments); err == nil {
			cfg["deployments"] = deployments
		}
	}

	// Persist API version if provided
	if options.APIVersion != "" {
		cfg["apiVersion"] = options.APIVersion
	}

	// Save config if it contains any keys
	if len(cfg) > 0 {
		configStore := database.NewProviderConfigStore()
		if saveErr := configStore.Save(instanceID, cfg); saveErr != nil {
			log.Warn().Err(saveErr).Str("provider", instanceID).Msg("Azure: failed to save config")
		}
	}

	log.Info().Str("provider", instanceID).Msg("Azure OpenAI authenticated via API key")
	return options.APIKey, resolvedEndpoint, cfg, nil
}

// ChatURL builds the Azure OpenAI chat completions URL for a deployment.
func ChatURL(endpoint, deployment, apiVersion string) (string, error) {
	if endpoint == "" {
		return "", fmt.Errorf("azure-openai endpoint not configured; set it via the admin UI")
	}
	if apiVersion == "" {
		apiVersion = "2024-08-01-preview"
	}
	return fmt.Sprintf("%s/openai/deployments/%s/chat/completions?api-version=%s",
		endpoint, deployment, apiVersion), nil
}

// ResponsesURL builds the Azure OpenAI Responses API URL.
func ResponsesURL(endpoint string) (string, error) {
	if endpoint == "" {
		return "", fmt.Errorf("azure-openai endpoint not configured; set it via the admin UI")
	}
	return endpoint + "/openai/v1/responses", nil
}

// Headers returns the HTTP headers for Azure OpenAI API requests.
func Headers(apiKey string) map[string]string {
	return map[string]string{
		"api-key":      apiKey,
		"Content-Type": "application/json",
	}
}

// DefaultModels is the built-in model catalog for Azure OpenAI.
var DefaultModels = []types.Model{
	{ID: "gpt-4o", Name: "GPT-4o", MaxTokens: 128000, Provider: "azure-openai"},
	{ID: "gpt-4o-mini", Name: "GPT-4o Mini", MaxTokens: 128000, Provider: "azure-openai"},
}

type DeploymentMapping struct {
	Model      string `json:"model"`
	Deployment string `json:"deployment"`
}

// DeploymentMappings returns Azure deployment mappings from config.
// It supports both legacy string deployments and structured model/deployment mappings.
func DeploymentMappings(config map[string]interface{}) []DeploymentMapping {
	if config == nil {
		return nil
	}
	raw, exists := config["deployments"]
	if !exists {
		return nil
	}

	switch value := raw.(type) {
	case []string:
		result := make([]DeploymentMapping, 0, len(value))
		for _, deployment := range value {
			deployment = strings.TrimSpace(deployment)
			if deployment == "" {
				continue
			}
			result = append(result, DeploymentMapping{Model: deployment, Deployment: deployment})
		}
		return result
	case []interface{}:
		result := make([]DeploymentMapping, 0, len(value))
		for _, item := range value {
			switch typed := item.(type) {
			case string:
				deployment := strings.TrimSpace(typed)
				if deployment == "" {
					continue
				}
				result = append(result, DeploymentMapping{Model: deployment, Deployment: deployment})
			case map[string]interface{}:
				model, _ := typed["model"].(string)
				deployment, _ := typed["deployment"].(string)
				model = strings.TrimSpace(model)
				deployment = strings.TrimSpace(deployment)
				if model == "" || deployment == "" {
					continue
				}
				result = append(result, DeploymentMapping{Model: model, Deployment: deployment})
			}
		}
		return result
	default:
		return nil
	}
}

// RemapModel maps an app-facing Azure model name to the configured Azure deployment name.
// If no mapping exists, it returns the original model unchanged.
func RemapModel(config map[string]interface{}, model string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return model
	}
	for _, mapping := range DeploymentMappings(config) {
		if strings.EqualFold(strings.TrimSpace(mapping.Model), model) {
			return mapping.Deployment
		}
	}
	return model
}

// ModelIDs returns the app-facing Azure model IDs from config.
func ModelIDs(config map[string]interface{}) []string {
	mappings := DeploymentMappings(config)
	result := make([]string, 0, len(mappings))
	for _, mapping := range mappings {
		if mapping.Model != "" {
			result = append(result, mapping.Model)
		}
	}
	return result
}

// GetModels returns the available models for this Azure OpenAI instance.
// If the config contains deployment mappings those are used; otherwise the
// built-in catalog is returned.
func GetModels(instanceID string, config map[string]interface{}) *types.ModelsResponse {
	if mappings := DeploymentMappings(config); len(mappings) > 0 {
		models := make([]types.Model, 0, len(mappings))
		for _, mapping := range mappings {
			models = append(models, types.Model{
				ID:        mapping.Model,
				Name:      mapping.Model,
				MaxTokens: 128000,
				Provider:  instanceID,
			})
		}
		return &types.ModelsResponse{Data: models, Object: "list"}
	}

	result := make([]types.Model, len(DefaultModels))
	for i, m := range DefaultModels {
		result[i] = m
		result[i].Provider = instanceID
	}
	return &types.ModelsResponse{Data: result, Object: "list"}
}

func stringSliceFromConfig(config map[string]interface{}, key string) []string {
	if config == nil {
		return nil
	}
	raw, exists := config[key]
	if !exists {
		return nil
	}
	switch value := raw.(type) {
	case []string:
		return value
	case []interface{}:
		result := make([]string, 0, len(value))
		for _, item := range value {
			if text, ok := item.(string); ok && text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

// IsResponsesAPIModel returns true for all Azure OpenAI models.
// Azure OpenAI uses the Responses API exclusively — this is the canonical
// API shape for this provider as defined in internal/providers/providermodels.
func IsResponsesAPIModel(_ string) bool {
	return true
}
