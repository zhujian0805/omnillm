package shared

import (
	"strings"
	"testing"
)

func TestUpstreamUserAgent_DefaultMimicsVSCode(t *testing.T) {
	// Reset the once-cache so a previous test in another file doesn't pin
	// the value before we get here.
	resetUpstreamUserAgentForTest(t)
	t.Setenv(UpstreamUserAgentEnv, "")

	got := UpstreamUserAgent()
	if got == "" {
		t.Fatal("UpstreamUserAgent() returned empty string")
	}
	// The whole point of this header is to look like VSCode's HTTP stack:
	// the upstream provider should see Code/<ver> and Electron/<ver>.
	for _, want := range []string{"Code/", "Electron/", "Chrome/", "Safari/"} {
		if !strings.Contains(got, want) {
			t.Errorf("UpstreamUserAgent() = %q\n\tmissing required substring %q", got, want)
		}
	}
	if got != DefaultVSCodeUserAgent {
		t.Errorf("UpstreamUserAgent() = %q\n\twant %q", got, DefaultVSCodeUserAgent)
	}
}

func TestUpstreamUserAgent_EnvOverride(t *testing.T) {
	resetUpstreamUserAgentForTest(t)
	custom := "VSCode/1.99.0 (custom build)"
	t.Setenv(UpstreamUserAgentEnv, custom)

	if got := UpstreamUserAgent(); got != custom {
		t.Errorf("UpstreamUserAgent() with %s=%q\n\tgot  %q\n\twant %q",
			UpstreamUserAgentEnv, custom, got, custom)
	}
}

func TestUpstreamUserAgent_EnvWhitespaceFallsBackToDefault(t *testing.T) {
	resetUpstreamUserAgentForTest(t)
	t.Setenv(UpstreamUserAgentEnv, "   ")

	if got := UpstreamUserAgent(); got != DefaultVSCodeUserAgent {
		t.Errorf("UpstreamUserAgent() with whitespace-only env = %q, want default", got)
	}
}
