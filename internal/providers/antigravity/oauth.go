// Package antigravity — Google OAuth2 authorization-code helpers.
package antigravity

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const (
	googleAuthURL  = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL = "https://oauth2.googleapis.com/token"

	// Scopes required to call the Antigravity (Cloud Code) API.
	OAuthScopes = "https://www.googleapis.com/auth/cloud-platform openid email"
)

// OAuthTokenResponse holds the payload returned by Google's token endpoint.
type OAuthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
	IDToken      string `json:"id_token,omitempty"`
	Error        string `json:"error,omitempty"`
	ErrorDesc    string `json:"error_description,omitempty"`
}

var oauthHTTPClient = &http.Client{Timeout: 30 * time.Second}

// BuildAuthURL returns the Google OAuth2 authorization URL that the user
// should visit to grant access.
func BuildAuthURL(clientID, redirectURI, state string) string {
	v := url.Values{}
	v.Set("client_id", clientID)
	v.Set("redirect_uri", redirectURI)
	v.Set("response_type", "code")
	v.Set("scope", OAuthScopes)
	v.Set("access_type", "offline")
	v.Set("prompt", "consent") // force refresh token to be returned
	v.Set("state", state)
	return googleAuthURL + "?" + v.Encode()
}

// ExchangeCode exchanges an authorization code for access + refresh tokens.
func ExchangeCode(clientID, clientSecret, code, redirectURI string) (*OAuthTokenResponse, error) {
	data := url.Values{}
	data.Set("code", code)
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("redirect_uri", redirectURI)
	data.Set("grant_type", "authorization_code")

	req, err := http.NewRequest("POST", googleTokenURL, bytes.NewBufferString(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("antigravity: failed to build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := oauthHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("antigravity: token exchange request failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var t OAuthTokenResponse
	if err := json.Unmarshal(body, &t); err != nil {
		return nil, fmt.Errorf("antigravity: failed to parse token response: %w", err)
	}
	if t.Error != "" {
		return nil, fmt.Errorf("antigravity: token exchange failed: %s — %s", t.Error, t.ErrorDesc)
	}
	if t.AccessToken == "" {
		return nil, fmt.Errorf("antigravity: no access_token in response: %s", string(body))
	}
	return &t, nil
}

// RefreshAccessToken exchanges a refresh token for a new access token.
func RefreshAccessToken(clientID, clientSecret, refreshToken string) (*OAuthTokenResponse, error) {
	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("refresh_token", refreshToken)
	data.Set("grant_type", "refresh_token")

	req, err := http.NewRequest("POST", googleTokenURL, bytes.NewBufferString(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("antigravity: failed to build refresh request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := oauthHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("antigravity: refresh request failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var t OAuthTokenResponse
	if err := json.Unmarshal(body, &t); err != nil {
		return nil, fmt.Errorf("antigravity: failed to parse refresh response: %w", err)
	}
	if t.Error != "" {
		return nil, fmt.Errorf("antigravity: token refresh failed: %s — %s", t.Error, t.ErrorDesc)
	}
	if t.AccessToken == "" {
		return nil, fmt.Errorf("antigravity: no access_token in refresh response: %s", string(body))
	}
	return &t, nil
}
