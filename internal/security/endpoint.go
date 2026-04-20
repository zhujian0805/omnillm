package security

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

func ValidateEndpoint(rawURL string, allowLocal bool) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return fmt.Errorf("invalid endpoint: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("endpoint must use http or https")
	}
	if parsed.Hostname() == "" {
		return fmt.Errorf("endpoint host is required")
	}
	if allowLocal {
		return nil
	}

	host := strings.ToLower(parsed.Hostname())
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return fmt.Errorf("local endpoints are not allowed")
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return nil
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return fmt.Errorf("private or link-local endpoints are not allowed")
	}
	return nil
}
