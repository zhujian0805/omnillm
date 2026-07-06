package openaicompatprovider

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"omnillm/internal/providers/shared"
)

// TestOutboundRequestImpersonatesVSCode wires the chat-completions adapter at
// an httptest server, fires a real Execute, and verifies the captured
// User-Agent header matches shared.UpstreamUserAgent() and contains the
// VSCode-shaped markers.
func TestOutboundRequestImpersonatesVSCode(t *testing.T) {
	var capturedUA atomic.Value

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUA.Store(r.Header.Get("User-Agent"))
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"chat_smoke","model":"smoke","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`)
	}))
	defer srv.Close()

	p := NewProvider("test-ua", "Test")
	p.baseURL = srv.URL + "/v1"
	p.configLoaded = true

	adapter := p.GetAdapter().(*Adapter)
	if _, err := adapter.Execute(context.Background(), sampleToolLoopRequest("anthropic")); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	got, _ := capturedUA.Load().(string)
	want := shared.UpstreamUserAgent()
	if got != want {
		t.Fatalf("User-Agent header\n\tgot  %q\n\twant %q", got, want)
	}
	for _, sub := range []string{"Code/", "Electron/", "Chrome/"} {
		if !strings.Contains(got, sub) {
			t.Errorf("User-Agent %q missing %q", got, sub)
		}
	}
}
