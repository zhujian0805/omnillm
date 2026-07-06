package shared

import (
	"os"
	"strings"
	"sync"
)

// DefaultVSCodeUserAgent is the canonical User-Agent OmniLLM advertises to
// upstream LLM providers. It mimics the Electron/Chromium User-Agent that
// the desktop Visual Studio Code editor sends from its built-in HTTP stack
// so upstream services see a "VSCode-shaped" client instead of a generic
// gateway. The exact version string is intentionally kept stable; if a
// specific deployment needs a different VSCode build, override it via the
// OMNILLM_UPSTREAM_USER_AGENT environment variable.
const DefaultVSCodeUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Code/1.95.3 Chrome/126.0.6478.234 Electron/30.5.1 Safari/537.36"

// UpstreamUserAgentEnv is the environment variable that overrides the
// User-Agent sent on outbound requests to upstream LLM providers.
const UpstreamUserAgentEnv = "OMNILLM_UPSTREAM_USER_AGENT"

var (
	upstreamUAOnce sync.Once
	upstreamUA     string
)

// resetUpstreamUserAgentForTest clears the cached User-Agent so tests can
// exercise different env-var configurations. It is intentionally lowercase
// (package-private) and only callable from tests in this package.
func resetUpstreamUserAgentForTest(_ tester) {
	upstreamUAOnce = sync.Once{}
	upstreamUA = ""
}

// tester is the minimal subset of *testing.T we need; defined here so the
// helper compiles in non-test builds (the testing import would otherwise
// pull testing into production binaries).
type tester interface{ Helper() }

// UpstreamUserAgent returns the User-Agent OmniLLM should send to upstream
// LLM providers. The value is resolved once on first call:
//
//  1. OMNILLM_UPSTREAM_USER_AGENT (when set and non-empty) wins; this lets
//     operators pin a specific VSCode build (or any other client string)
//     without rebuilding.
//  2. Otherwise DefaultVSCodeUserAgent is used.
//
// Provider-specific header builders should call this when assembling
// outbound headers for chat, responses, embeddings, and model-list calls
// to third-party LLM endpoints.
//
// Excluded by design: provider integrations whose backend mandates a
// particular User-Agent (GitHub Copilot, Codex via Copilot OAuth, Google
// Antigravity) keep their hard-coded values — the upstream verifies them
// and a VSCode UA there would break auth or routing.
func UpstreamUserAgent() string {
	upstreamUAOnce.Do(func() {
		if v := strings.TrimSpace(os.Getenv(UpstreamUserAgentEnv)); v != "" {
			upstreamUA = v
			return
		}
		upstreamUA = DefaultVSCodeUserAgent
	})
	return upstreamUA
}
