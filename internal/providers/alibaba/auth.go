// Package alibaba provides simplified API key authentication for DashScope.
package alibaba

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ─── Constants ────────────────────────────────────────────────────────────────

var (
	alibabaHTTPClient   = &http.Client{Timeout: 120 * time.Second}
	alibabaStreamClient = &http.Client{}
)

const (
	// BaseURLChina is the DashScope endpoint for mainland China.
	BaseURLChina = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	// BaseURLGlobal is the DashScope endpoint for the international (non-China) region.
	BaseURLGlobal = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
	// CodingPlanBaseURLChina is the Coding Plan endpoint for mainland China.
	CodingPlanBaseURLChina = "https://coding.dashscope.aliyuncs.com/v1"
	// CodingPlanBaseURLGlobal is the Coding Plan endpoint for the international region.
	CodingPlanBaseURLGlobal = "https://coding-intl.dashscope.aliyuncs.com/v1"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// TokenData is the persisted credential record for an Alibaba instance.
// It is stored as JSON in the token database and must stay compatible with the
// TypeScript AlibabaTokenData shape.
type TokenData struct {
	AuthType    string `json:"auth_type"`             // "api-key" or "oauth"
	AccessToken string `json:"access_token"`          // API key or access token
	BaseURL     string `json:"base_url"`              // explicit base URL for api-key auth
	ExpiresAt   int64  `json:"expires_at,omitempty"`  // epoch milliseconds; 0 = never expires
}

// DeviceFlowResponse is a stub for backwards compatibility
type DeviceFlowResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
	CodeVerifier            string `json:"-"`
}

// ─── Deprecated OAuth Functions (Stubs) ──────────────────────────────────────

// InitiateDeviceFlow returns an error since OAuth is no longer supported
func InitiateDeviceFlow(ctx context.Context) (*DeviceFlowResponse, error) {
	return nil, fmt.Errorf("oauth authentication is no longer supported for Alibaba DashScope - please use API key authentication")
}

// PollForToken returns an error since OAuth is no longer supported
func PollForToken(ctx context.Context, deviceCode, codeVerifier string, intervalSec, expiresIn int) (*TokenData, error) {
	return nil, fmt.Errorf("oauth authentication is no longer supported for Alibaba DashScope - please use API key authentication")
}

// RefreshToken returns an error since OAuth is no longer supported
func RefreshToken(ctx context.Context, refreshToken string) (*TokenData, error) {
	return nil, fmt.Errorf("oauth authentication is no longer supported for Alibaba DashScope - please use API key authentication")
}

// IsExpiringSoon returns true when the token has expired (ExpiresAt is in the past).
// API keys never expire and always return false.
func IsExpiringSoon(data *TokenData) bool {
	if data == nil {
		return false
	}
	if strings.ToLower(data.AuthType) == "api-key" {
		return false
	}
	if data.ExpiresAt <= 0 {
		return false
	}
	return data.ExpiresAt <= time.Now().UnixMilli()
}

// IsJWT returns true when token looks like a three-part dot-separated JWT.
func IsJWT(token string) bool {
	if token == "" {
		return false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	return parts[0] != "" && parts[1] != "" && parts[2] != ""
}

// ShortTokenSuffix returns the last 5 characters for display.
// Returns "oauth" for empty/whitespace tokens (OAuth flow display).
func ShortTokenSuffix(token string) string {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return "oauth"
	}
	if len(trimmed) >= 5 {
		return trimmed[len(trimmed)-5:]
	}
	return trimmed
}

// ExtractEmailFromJWT decodes the JWT payload and returns the "email" claim, or "".
func ExtractEmailFromJWT(token string) string {
	if !IsJWT(token) {
		return ""
	}
	parts := strings.Split(token, ".")
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return ""
	}
	if email, ok := payload["email"].(string); ok {
		return email
	}
	return ""
}


// NormaliseBaseURL ensures a resource URL ends in "/v1" with an https scheme.
func NormaliseBaseURL(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	lower := strings.ToLower(s)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		s = "https://" + s
	}
	s = strings.TrimRight(s, "/")
	if !strings.HasSuffix(strings.ToLower(s), "/v1") {
		s += "/v1"
	}
	return s
}

// generateCodeChallenge computes a PKCE S256 code challenge from a verifier:
// base64url(sha256(verifier)) without padding.
func generateCodeChallenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return strings.TrimRight(base64.URLEncoding.EncodeToString(h[:]), "=")
}

// min returns the smaller of two durations.
func min(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
