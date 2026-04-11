package routes

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
)

type stubProviderError struct {
	statusCode int
	auth       bool
}

func (e stubProviderError) Error() string {
	return "provider failed"
}

func (e stubProviderError) StatusCode() int {
	return e.statusCode
}

func (e stubProviderError) IsAuthenticationError() bool {
	return e.auth
}

func TestProviderErrorHelpersTreatWrappedAuthErrorsAsAuthenticationFailures(t *testing.T) {
	err := fmt.Errorf("wrapped: %w", stubProviderError{
		statusCode: http.StatusUnauthorized,
		auth:       true,
	})

	if !isAuthenticationError(err) {
		t.Fatal("expected wrapped auth error to be detected")
	}
	if shouldFallbackToNonStreaming(err) {
		t.Fatal("expected auth errors to skip non-stream fallback")
	}
	if providerFailureStatus(err) != http.StatusUnauthorized {
		t.Fatalf("expected provider auth failure to return 401, got %d", providerFailureStatus(err))
	}
	if providerFailureType("api_error", err) != "authentication_error" {
		t.Fatalf("expected authentication_error type, got %q", providerFailureType("api_error", err))
	}
}

func TestProviderErrorHelpersDetectTokenExpiredMessages(t *testing.T) {
	err := errors.New("API request failed with status 401: IDE token expired: unauthorized: token expired")

	if !isAuthenticationError(err) {
		t.Fatal("expected token expired text to be detected as auth error")
	}
	if shouldFallbackToNonStreaming(err) {
		t.Fatal("expected token expired text to skip non-stream fallback")
	}
}

func TestProviderErrorHelpersKeepFallbackForNonAuthErrors(t *testing.T) {
	err := fmt.Errorf("wrapped: %w", stubProviderError{
		statusCode: http.StatusBadGateway,
		auth:       false,
	})

	if isAuthenticationError(err) {
		t.Fatal("expected non-auth error to stay non-auth")
	}
	if !shouldFallbackToNonStreaming(err) {
		t.Fatal("expected non-auth streaming errors to keep fallback behavior")
	}
	if providerFailureStatus(err) != http.StatusBadGateway {
		t.Fatalf("expected non-auth failure to return 502, got %d", providerFailureStatus(err))
	}
}
