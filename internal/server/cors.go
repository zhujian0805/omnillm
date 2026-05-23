package server

import (
	"net/url"
	"strings"
)

var allowedChromeExtensionIDs map[string]struct{}

func configureAllowedOrigins(extensionIDs []string) {
	if len(extensionIDs) == 0 {
		allowedChromeExtensionIDs = nil
		return
	}

	allowedChromeExtensionIDs = make(map[string]struct{}, len(extensionIDs))
	for _, id := range extensionIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			continue
		}
		allowedChromeExtensionIDs[trimmed] = struct{}{}
	}

	if len(allowedChromeExtensionIDs) == 0 {
		allowedChromeExtensionIDs = nil
	}
}

func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}

	u, err := url.Parse(origin)
	if err != nil {
		return false
	}

	if u.Scheme == "chrome-extension" {
		if len(allowedChromeExtensionIDs) == 0 {
			return true
		}
		_, ok := allowedChromeExtensionIDs[u.Host]
		return ok
	}

	host := u.Hostname()
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}
