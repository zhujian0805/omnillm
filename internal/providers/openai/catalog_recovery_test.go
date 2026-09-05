package openai

import (
	"io"
	"net/http"
	"omnillm/internal/lib/catalogcache"
	"omnillm/internal/lib/catalogstate"
	"strings"
	"testing"
	"time"
)

type catalogTransport func(*http.Request) (*http.Response, error)

func (f catalogTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestOpenAICatalogOutageAndForcedRefresh(t *testing.T) {
	oldClient, oldCache := modelsHTTPClient, modelCatalogCache
	t.Cleanup(func() { modelsHTTPClient = oldClient; modelCatalogCache = oldCache })
	modelCatalogCache = catalogcache.New(15*time.Minute, time.Hour)
	p := NewProvider("openai-catalog-outage", "")
	p.accessToken = "test-token"
	p.expiresAt = time.Now().Add(time.Hour).Unix()
	status, calls := 200, 0
	modelsHTTPClient = &http.Client{Transport: catalogTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Query().Get("client_version") == "" {
			t.Error("missing client version")
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(`{"models":[{"slug":"gpt-6-astra","context_window":128000,"visibility":"list"}]}`)), Header: make(http.Header)}, nil
	})}
	got, _ := p.GetModels()
	if got.Degraded || got.Data[0].ID != "gpt-6-astra" {
		t.Fatalf("live: %+v", got)
	}
	status = 503
	catalogstate.Refresh(p.GetInstanceID())
	got, _ = p.GetModels()
	if !got.Degraded || got.Data[0].ID != "gpt-6-astra" {
		t.Fatalf("last good: %+v", got)
	}
	if p.RemapModel("gpt-6-astra") != "gpt-6-astra" {
		t.Fatal("remapped Astra")
	}
	if calls != 2 {
		t.Fatalf("backoff calls=%d", calls)
	}
	status = 200
	catalogstate.Refresh(p.GetInstanceID())
	got, _ = p.GetModels()
	if got.Degraded || calls != 3 {
		t.Fatalf("refresh: %+v calls=%d", got, calls)
	}
	status = 401
	catalogstate.Refresh(p.GetInstanceID())
	got, _ = p.GetModels()
	if !got.Degraded || got.Source != "built-in" {
		t.Fatalf("authentication retained stale: %+v", got)
	}
	status = 200
	InvalidateModelsCache(p.GetInstanceID())
	got, _ = p.GetModels()
	if got.Degraded {
		t.Fatal("account invalidation did not bypass backoff")
	}
}

func TestAstraIsNotReplacedByFallbackDefault(t *testing.T) {
	if got := remapAgainst("gpt-6-astra", Models); got != "gpt-6-astra" {
		t.Fatalf("upstream model = %q, want exact Astra", got)
	}
}
