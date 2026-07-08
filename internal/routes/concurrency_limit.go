package routes

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// ConcurrencyLimiter bounds the number of in-flight requests that may execute
// the handler chain concurrently. It exists to provide predictable backpressure
// when many clients connect at once: instead of letting an unbounded number of
// goroutines pile up on upstream provider connections (and memory), excess
// requests fail fast with 503 Service Unavailable and a Retry-After hint.
//
// A limit of zero (or negative) disables limiting entirely — the middleware
// becomes a pass-through, preserving the historical unbounded behavior unless an
// operator explicitly opts in.
type ConcurrencyLimiter struct {
	// sem is a counting semaphore implemented as a buffered channel: a token is
	// sent on acquire and received on release. Capacity == the concurrency limit.
	// nil when limiting is disabled.
	sem chan struct{}
}

// NewConcurrencyLimiter returns a limiter allowing at most `limit` concurrent
// requests through Middleware. limit <= 0 disables limiting.
func NewConcurrencyLimiter(limit int) *ConcurrencyLimiter {
	if limit <= 0 {
		return &ConcurrencyLimiter{sem: nil}
	}

	return &ConcurrencyLimiter{sem: make(chan struct{}, limit)}
}

// Limit reports the configured maximum concurrency, or 0 when disabled.
func (l *ConcurrencyLimiter) Limit() int {
	if l == nil || l.sem == nil {
		return 0
	}

	return cap(l.sem)
}

// InFlight returns the number of requests currently holding a slot.
func (l *ConcurrencyLimiter) InFlight() int {
	if l == nil || l.sem == nil {
		return 0
	}

	return len(l.sem)
}

// Middleware returns a gin middleware enforcing the limit. When the limiter is
// disabled it returns a no-op pass-through so there is zero overhead on the hot
// path in the default configuration.
func (l *ConcurrencyLimiter) Middleware() gin.HandlerFunc {
	if l == nil || l.sem == nil {
		return func(c *gin.Context) { c.Next() }
	}

	limit := cap(l.sem)

	return func(c *gin.Context) {
		select {
		case l.sem <- struct{}{}:
			// Acquired a slot; ensure it is released even if a handler panics
			// (gin.Recovery runs after this deferred release).
			defer func() { <-l.sem }()

			c.Next()
		default:
			// Saturated: fail fast rather than queueing unbounded work.
			c.Header("Retry-After", "1")
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": "Server is at capacity (" + strconv.Itoa(limit) +
						" concurrent requests); please retry shortly.",
					"type": "server_overloaded",
				},
			})
		}
	}
}
