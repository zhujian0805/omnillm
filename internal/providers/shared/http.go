package shared

import (
	"net/http"
	"time"
)

// DefaultHTTPTransport returns a new *http.Transport with production-safe
// connection pool settings. Every provider client should use this instead of
// repeating the same boilerplate or relying on Go's default Transport
// (which has MaxIdleConnsPerHost=2 — far too low under concurrent load).
//
// Callers that need a streaming client should omit Timeout (set it to 0) so
// long-lived SSE connections are not cut off by an idle timeout.
func DefaultHTTPTransport() *http.Transport {
	return &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
		MaxConnsPerHost:       50,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
}

// DefaultHTTPClient returns an *http.Client suitable for non-streaming
// (request-response) provider calls. Uses DefaultHTTPTransport.
func DefaultHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: DefaultHTTPTransport(),
	}
}

// DefaultStreamClient returns an *http.Client suitable for streaming (SSE)
// provider calls — no Timeout so long-lived connections are not cut off.
func DefaultStreamClient() *http.Client {
	return &http.Client{
		Transport: DefaultHTTPTransport(),
	}
}
