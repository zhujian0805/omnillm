package server

// Tests for the "<providerPrefix>/<modelID>" routing feature.
//
// Each sub-test registers one or more stub providers (with real instance IDs
// and subtitles seeded into the DB), then fires a chat-completions request
// whose model field contains a prefix.  The adapter capture function verifies
// that exactly the right provider was chosen and that the bare model name (no
// prefix) was forwarded upstream.
//
// Provider / subtitle mapping used throughout:
//   instanceID          subtitle          model
//   ─────────────────── ───────────────── ──────────────────────────────
//   pfx-alibaba-01      alipay01          deepseek-v4-flash
//   pfx-alibaba-02      alipay02          deepseek-v4-flash
//   pfx-alibaba-03      ntes              qwen3.6-plus
//   pfx-copilot-abk     copilot-jzhu-abk  gpt-5-mini
//   pfx-openai-compat   c161bf            deepseek-ai/DeepSeek-V4-Flash
//   (no subtitle)       —                 custom-model

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"omnillm/internal/cif"
	"omnillm/internal/database"
	providertypes "omnillm/internal/providers/types"
	"omnillm/internal/registry"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

// registerPrefixProvider registers a stub provider with the given instanceID,
// subtitle, and model, seeds a DB record so the subtitle is stored, and
// returns the instanceID. The capturedModel pointer is set by the adapter when
// a request arrives.
func registerPrefixProvider(
	t *testing.T,
	instanceID, subtitle, providerType, modelID string,
	capturedModel *string,
) {
	t.Helper()

	model := providertypes.Model{ID: modelID, Name: modelID, Provider: instanceID}
	provider := &stubProvider{
		id:         providerType,
		instanceID: instanceID,
		name:       instanceID,
		models:     &providertypes.ModelsResponse{Object: "list", Data: []providertypes.Model{model}},
	}
	adapter := &stubAdapter{
		executeFn: func(_ context.Context, req *cif.CanonicalRequest) (*cif.CanonicalResponse, error) {
			if capturedModel != nil {
				*capturedModel = req.Model
			}
			return &cif.CanonicalResponse{
				ID:    "resp-prefix-test",
				Model: req.Model,
				Content: []cif.CIFContentPart{
					cif.CIFTextPart{Type: "text", Text: "pong"},
				},
				StopReason: cif.StopReasonEndTurn,
			}, nil
		},
	}
	provider.adapter = adapter
	adapter.provider = provider

	reg := registry.GetProviderRegistry()
	if err := reg.Register(provider, false); err != nil {
		t.Fatalf("register %s: %v", instanceID, err)
	}
	if _, err := reg.AddActive(instanceID); err != nil {
		t.Fatalf("activate %s: %v", instanceID, err)
	}

	// Seed subtitle into DB so resolveProviderPrefix can match it.
	store := database.NewProviderInstanceStore()
	if err := store.Save(&database.ProviderInstanceRecord{
		InstanceID: instanceID,
		ProviderID: providerType,
		Name:       instanceID,
		Subtitle:   subtitle,
		Priority:   0,
		Activated:  true,
	}); err != nil {
		t.Fatalf("seed DB record for %s: %v", instanceID, err)
	}

	t.Cleanup(func() {
		_ = reg.Remove(instanceID)
		_ = store.Delete(instanceID)
	})
}

// chatCompletions fires a POST /v1/chat/completions with the given model and
// returns the raw response body and HTTP status.
func chatCompletions(t *testing.T, srvURL, model string) (int, string) {
	t.Helper()
	body := fmt.Sprintf(`{"model":%q,"messages":[{"role":"user","content":"ping"}]}`, model)
	resp := postJSON(t, srvURL+"/v1/chat/completions", body, nil)
	return resp.StatusCode, readBody(t, resp)
}

// ─── tests ────────────────────────────────────────────────────────────────────

// TestProviderPrefixRouting_BySubtitle verifies that using the subtitle as a
// prefix (e.g. "alipay01/deepseek-v4-flash") routes to the correct provider
// when two providers expose the same model ID.
func TestProviderPrefixRouting_BySubtitle(t *testing.T) {
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	var captured01, captured02 string
	id01 := "pfx-alibaba-01-" + uniqueSuffix
	id02 := "pfx-alibaba-02-" + uniqueSuffix

	registerPrefixProvider(t, id01, "alipay01pfx"+uniqueSuffix, "stub-provider", "deepseek-v4-flash", &captured01)
	registerPrefixProvider(t, id02, "alipay02pfx"+uniqueSuffix, "stub-provider", "deepseek-v4-flash", &captured02)

	subtitle01 := "alipay01pfx" + uniqueSuffix
	subtitle02 := "alipay02pfx" + uniqueSuffix

	srv := newTestServer(t)
	defer srv.Close()

	t.Run("subtitle01 prefix routes to provider 01", func(t *testing.T) {
		captured01, captured02 = "", ""
		status, body := chatCompletions(t, srv.URL, subtitle01+"/deepseek-v4-flash")
		if status != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", status, body)
		}
		if captured01 != "deepseek-v4-flash" {
			t.Errorf("provider 01 should have received the request; capturedModel=%q", captured01)
		}
		if captured02 != "" {
			t.Errorf("provider 02 should NOT have received the request; capturedModel=%q", captured02)
		}
	})

	t.Run("subtitle02 prefix routes to provider 02", func(t *testing.T) {
		captured01, captured02 = "", ""
		status, body := chatCompletions(t, srv.URL, subtitle02+"/deepseek-v4-flash")
		if status != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", status, body)
		}
		if captured02 != "deepseek-v4-flash" {
			t.Errorf("provider 02 should have received the request; capturedModel=%q", captured02)
		}
		if captured01 != "" {
			t.Errorf("provider 01 should NOT have received the request; capturedModel=%q", captured01)
		}
	})
}

// TestProviderPrefixRouting_ByInstanceID verifies that using the raw instance
// ID as a prefix also works when no subtitle is set.
func TestProviderPrefixRouting_ByInstanceID(t *testing.T) {
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())
	instanceID := "pfx-no-subtitle-" + uniqueSuffix

	var capturedModel string
	// Subtitle is intentionally empty so the only match is via instance ID.
	registerPrefixProvider(t, instanceID, "", "stub-provider", "custom-model", &capturedModel)

	srv := newTestServer(t)
	defer srv.Close()

	status, body := chatCompletions(t, srv.URL, instanceID+"/custom-model")
	if status != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", status, body)
	}
	if capturedModel != "custom-model" {
		t.Errorf("expected bare model name %q forwarded; got %q", "custom-model", capturedModel)
	}
}

// TestProviderPrefixRouting_Copilot verifies the copilot-jzhu-abk/gpt-5-mini
// prefix pattern specifically requested in the issue.
func TestProviderPrefixRouting_Copilot(t *testing.T) {
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())
	instanceID := "pfx-copilot-abk-" + uniqueSuffix
	subtitle := "copilot-jzhu-abkpfx" + uniqueSuffix

	var capturedModel string
	registerPrefixProvider(t, instanceID, subtitle, "copilot", "gpt-5-mini", &capturedModel)

	srv := newTestServer(t)
	defer srv.Close()

	status, body := chatCompletions(t, srv.URL, subtitle+"/gpt-5-mini")
	if status != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", status, body)
	}
	if capturedModel != "gpt-5-mini" {
		t.Errorf("expected bare model %q forwarded; got %q", "gpt-5-mini", capturedModel)
	}
}

// TestProviderPrefixRouting_SlashInModelID verifies that a model ID containing
// "/" (e.g. "deepseek-ai/DeepSeek-V4-Flash") is forwarded correctly when only
// the first slash is the separator.
func TestProviderPrefixRouting_SlashInModelID(t *testing.T) {
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())
	instanceID := "pfx-openai-compat-" + uniqueSuffix
	subtitle := "c161bfpfx" + uniqueSuffix
	modelID := "deepseek-ai/DeepSeek-V4-Flash"

	var capturedModel string
	registerPrefixProvider(t, instanceID, subtitle, "openai-compat", modelID, &capturedModel)

	srv := newTestServer(t)
	defer srv.Close()

	// Full request model: "<subtitle>/deepseek-ai/DeepSeek-V4-Flash"
	requestModel := subtitle + "/" + modelID
	status, body := chatCompletions(t, srv.URL, requestModel)
	if status != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", status, body)
	}
	if capturedModel != modelID {
		t.Errorf("expected bare model %q forwarded; got %q", modelID, capturedModel)
	}
}

// TestProviderPrefixRouting_UnknownPrefix verifies that a prefix that matches
// no known instance ID or subtitle produces a 502/404-style error rather than
// silently routing elsewhere.
func TestProviderPrefixRouting_UnknownPrefix(t *testing.T) {
	srv := newTestServer(t)
	defer srv.Close()

	status, body := chatCompletions(t, srv.URL, "totally-unknown-prefix-xyz/gpt-4o")
	if status == http.StatusOK {
		t.Fatalf("expected error response for unknown prefix, got 200: %s", body)
	}
}

// TestProviderPrefixRouting_NoPrefixUnaffected verifies that requests without
// a "/" continue to work with normal provider selection (no regression).
func TestProviderPrefixRouting_NoPrefixUnaffected(t *testing.T) {
	const modelID = "no-prefix-model"

	var capturedModel string
	registerStubProvider(
		t,
		modelID,
		func(_ context.Context, req *cif.CanonicalRequest) (*cif.CanonicalResponse, error) {
			capturedModel = req.Model
			return &cif.CanonicalResponse{
				ID:    "resp-no-prefix",
				Model: req.Model,
				Content: []cif.CIFContentPart{cif.CIFTextPart{Type: "text", Text: "pong"}},
				StopReason: cif.StopReasonEndTurn,
			}, nil
		},
		nil,
	)

	srv := newTestServer(t)
	defer srv.Close()

	status, body := chatCompletions(t, srv.URL, modelID)
	if status != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", status, body)
	}
	if capturedModel != modelID {
		t.Errorf("expected model %q, got %q", modelID, capturedModel)
	}
}

// TestProviderPrefixRouting_AlibabaThreeProviders exercises the multi-provider
// disambiguation scenario: three Alibaba-style providers all serving the same
// model name.  Each subtitle-prefix must route to exactly one.
func TestProviderPrefixRouting_AlibabaThreeProviders(t *testing.T) {
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())

	var captured [3]string
	subtitles := [3]string{
		"alipay01three" + uniqueSuffix,
		"alipay02three" + uniqueSuffix,
		"ntesthree" + uniqueSuffix,
	}
	models := [3]string{"qwen3.6-plus", "qwen3.6-plus", "qwen3.6-plus"}

	for i := 0; i < 3; i++ {
		idx := i // capture
		registerPrefixProvider(
			t,
			fmt.Sprintf("pfx-alibaba-%02d-three-%s", i+1, uniqueSuffix),
			subtitles[idx],
			"stub-provider",
			models[idx],
			&captured[idx],
		)
	}

	srv := newTestServer(t)
	defer srv.Close()

	for i := 0; i < 3; i++ {
		idx := i
		t.Run(fmt.Sprintf("routes_to_provider_%d", idx+1), func(t *testing.T) {
			captured[0], captured[1], captured[2] = "", "", ""
			requestModel := subtitles[idx] + "/qwen3.6-plus"
			status, body := chatCompletions(t, srv.URL, requestModel)
			if status != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", status, body)
			}
			if captured[idx] != "qwen3.6-plus" {
				t.Errorf("provider %d should have received the request (model=%q)", idx+1, captured[idx])
			}
			for j := 0; j < 3; j++ {
				if j == idx {
					continue
				}
				if captured[j] != "" {
					t.Errorf("provider %d should NOT have received the request (model=%q)", j+1, captured[j])
				}
			}
		})
	}
}

// TestProviderPrefixRouting_PrefixCaseInsensitive verifies that subtitle
// matching is case-insensitive, e.g. "ALIPAY01" matches subtitle "alipay01".
func TestProviderPrefixRouting_PrefixCaseInsensitive(t *testing.T) {
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())
	instanceID := "pfx-case-" + uniqueSuffix
	subtitle := "casetestpfx" + uniqueSuffix

	var capturedModel string
	registerPrefixProvider(t, instanceID, subtitle, "stub-provider", "some-model", &capturedModel)

	srv := newTestServer(t)
	defer srv.Close()

	// Use uppercased subtitle as prefix
	upperSubtitle := "CASETESTPFX" + uniqueSuffix
	status, body := chatCompletions(t, srv.URL, upperSubtitle+"/some-model")
	if status != http.StatusOK {
		t.Fatalf("expected 200 with upper-case prefix, got %d: %s", status, body)
	}
	if capturedModel != "some-model" {
		t.Errorf("expected model %q forwarded; got %q", "some-model", capturedModel)
	}
}

// TestProviderPrefixRouting_ResponseModelIsBareName verifies that the model
// field in the JSON response contains the bare model name (no prefix).
func TestProviderPrefixRouting_ResponseModelIsBareName(t *testing.T) {
	uniqueSuffix := fmt.Sprintf("%d", time.Now().UnixNano())
	instanceID := "pfx-resp-" + uniqueSuffix
	subtitle := "resppfx" + uniqueSuffix

	registerPrefixProvider(t, instanceID, subtitle, "stub-provider", "resp-model", nil)

	srv := newTestServer(t)
	defer srv.Close()

	resp := postJSON(
		t,
		srv.URL+"/v1/chat/completions",
		fmt.Sprintf(`{"model":%q,"messages":[{"role":"user","content":"ping"}]}`, subtitle+"/resp-model"),
		nil,
	)
	body := readBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, body)
	}

	var parsed struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatalf("parse response: %v", err)
	}
	if parsed.Model != "resp-model" {
		t.Errorf("expected response model %q (no prefix), got %q", "resp-model", parsed.Model)
	}
}
