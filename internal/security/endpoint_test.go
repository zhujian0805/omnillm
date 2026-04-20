package security

import "testing"

func TestValidateEndpointRejectsLocalhost(t *testing.T) {
	if err := ValidateEndpoint("http://localhost:11434/v1", false); err == nil {
		t.Fatal("expected localhost endpoint to be rejected")
	}
}

func TestValidateEndpointRejectsLinkLocal(t *testing.T) {
	if err := ValidateEndpoint("http://169.254.169.254/latest/meta-data", false); err == nil {
		t.Fatal("expected link-local endpoint to be rejected")
	}
}

func TestValidateEndpointAllowsPublicHTTPS(t *testing.T) {
	if err := ValidateEndpoint("https://api.openai.com/v1", false); err != nil {
		t.Fatalf("expected public endpoint to be allowed: %v", err)
	}
}

func TestValidateEndpointAllowsLocalWhenEnabled(t *testing.T) {
	if err := ValidateEndpoint("http://localhost:11434/v1", true); err != nil {
		t.Fatalf("expected localhost endpoint to be allowed when enabled: %v", err)
	}
}
