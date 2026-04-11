package routes

import (
	"errors"
	"net/http"
	"strings"
)

func isAuthenticationError(err error) bool {
	if err == nil {
		return false
	}

	var authErr interface{ IsAuthenticationError() bool }
	if errors.As(err, &authErr) && authErr.IsAuthenticationError() {
		return true
	}

	var statusErr interface{ StatusCode() int }
	if errors.As(err, &statusErr) {
		switch statusErr.StatusCode() {
		case http.StatusUnauthorized, http.StatusForbidden:
			return true
		}
	}

	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "status 401") ||
		strings.Contains(msg, "token expired") ||
		strings.Contains(msg, "unauthorized")
}

func shouldFallbackToNonStreaming(err error) bool {
	return err != nil && !isAuthenticationError(err)
}

func providerFailureStatus(err error) int {
	if isAuthenticationError(err) {
		return http.StatusUnauthorized
	}
	return http.StatusBadGateway
}

func providerFailureType(defaultType string, err error) string {
	if isAuthenticationError(err) {
		return "authentication_error"
	}
	return defaultType
}
