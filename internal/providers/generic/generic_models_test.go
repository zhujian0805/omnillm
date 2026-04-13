package generic

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"omnimodel/internal/database"
)

func TestAlibabaGetModelsFetchesLiveModels(t *testing.T) {
	if err := database.InitializeDatabase(t.TempDir()); err != nil {
		t.Fatalf("failed to initialize database: %v", err)
	}
	t.Cleanup(func() {
		_ = database.GetDatabase().Close()
	})

	var requestPath string
	var authorization string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen3-max"},{"id":"qwen3.5-omni-plus-realtime-2026-03-15"},{"id":"custom-live-model"}]}`))
	}))
	defer server.Close()

	tokenStore := database.NewTokenStore()
	if err := tokenStore.Save("alibaba-live", "alibaba", map[string]interface{}{
		"access_token": "test-token",
		"auth_type":    "api-key",
		"base_url":     server.URL,
	}); err != nil {
		t.Fatalf("failed to save token: %v", err)
	}

	provider := NewGenericProvider("alibaba", "alibaba-live", "Alibaba")
	if err := provider.LoadFromDB(); err != nil {
		t.Fatalf("failed to load provider from database: %v", err)
	}

	models, err := provider.GetModels()
	if err != nil {
		t.Fatalf("GetModels() error = %v", err)
	}

	if requestPath != "/v1/models" {
		t.Fatalf("expected Alibaba models request to hit /v1/models, got %q", requestPath)
	}
	if authorization != "Bearer test-token" {
		t.Fatalf("expected bearer token header, got %q", authorization)
	}
	if models.Object != "list" {
		t.Fatalf("expected object=list, got %q", models.Object)
	}
	if len(models.Data) != 2 {
		t.Fatalf("expected filtered live model count 2, got %d", len(models.Data))
	}

	first := models.Data[0]
	if first.ID != "qwen3-max" {
		t.Fatalf("unexpected first model id: %q", first.ID)
	}
	if first.Name != "Qwen3 Max" {
		t.Fatalf("expected metadata-enriched name, got %q", first.Name)
	}
	if first.MaxTokens != 32768 {
		t.Fatalf("expected metadata-enriched max tokens, got %d", first.MaxTokens)
	}
	if first.Provider != "alibaba-live" {
		t.Fatalf("expected provider instance id, got %q", first.Provider)
	}

	second := models.Data[1]
	if second.ID != "custom-live-model" {
		t.Fatalf("unexpected second model id: %q", second.ID)
	}
	if second.Name != "custom-live-model" {
		t.Fatalf("expected unknown model to keep its raw id as name, got %q", second.Name)
	}
	if second.MaxTokens != 0 {
		t.Fatalf("expected unknown model max tokens to remain unset, got %d", second.MaxTokens)
	}
}

func TestAlibabaApplyConfigUsesOAuthResourceURL(t *testing.T) {
	provider := NewGenericProvider("alibaba", "alibaba-oauth", "Alibaba")
	provider.applyConfig(map[string]interface{}{
		"auth_type":    "oauth",
		"base_url":     "https://ignored.example.com/custom",
		"resource_url": "enterprise.example.com/compatible-mode",
	})

	if provider.baseURL != "https://enterprise.example.com/compatible-mode/v1" {
		t.Fatalf("expected OAuth resource_url to win, got %q", provider.baseURL)
	}
}

func TestAlibabaOAuthGetModelsUsesSupportedCatalog(t *testing.T) {
	if err := database.InitializeDatabase(t.TempDir()); err != nil {
		t.Fatalf("failed to initialize database: %v", err)
	}
	t.Cleanup(func() {
		_ = database.GetDatabase().Close()
	})

	tokenStore := database.NewTokenStore()
	if err := tokenStore.Save("alibaba-oauth-test", "alibaba", map[string]interface{}{
		"access_token": "oauth-token",
		"auth_type":    "oauth",
		"resource_url": "portal.qwen.ai",
	}); err != nil {
		t.Fatalf("failed to save token: %v", err)
	}

	provider := NewGenericProvider("alibaba", "alibaba-oauth-test", "Alibaba")
	if err := provider.LoadFromDB(); err != nil {
		t.Fatalf("failed to load provider from database: %v", err)
	}

	models, err := provider.GetModels()
	if err != nil {
		t.Fatalf("GetModels() error = %v", err)
	}
	if len(models.Data) != 2 {
		t.Fatalf("expected 2 supported OAuth models, got %d", len(models.Data))
	}
	if models.Data[0].ID != "qwen3-coder-plus" && models.Data[1].ID != "qwen3-coder-plus" {
		t.Fatalf("expected qwen3-coder-plus in OAuth model list, got %#v", models.Data)
	}
	if models.Data[0].ID != "qwen3-coder-flash" && models.Data[1].ID != "qwen3-coder-flash" {
		t.Fatalf("expected qwen3-coder-flash in OAuth model list, got %#v", models.Data)
	}
}
