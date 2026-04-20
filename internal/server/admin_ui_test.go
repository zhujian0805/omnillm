package server

import (
	"strings"
	"testing"
)

func TestInjectAPIKeyMetaInjectsAPIKey(t *testing.T) {
	html := injectAPIKeyMeta("<html><head><title>OmniModel Admin</title></head></html>", "secret-key")
	if !strings.Contains(html, `meta name="omnimodel-api-key" content="secret-key"`) {
		t.Fatalf("expected injected api key meta tag, got: %s", html)
	}
}
