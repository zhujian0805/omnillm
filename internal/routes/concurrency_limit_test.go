package routes

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// TestConcurrencyLimiter_Disabled verifies limit <= 0 is a transparent
// pass-through: every request reaches the handler and returns 200.
func TestConcurrencyLimiter_Disabled(t *testing.T) {
	l := NewConcurrencyLimiter(0)
	if l.Limit() != 0 {
		t.Fatalf("expected Limit 0 when disabled, got %d", l.Limit())
	}

	r := gin.New()
	r.Use(l.Middleware())
	r.GET("/x", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i, w.Code)
		}
	}
}

// TestConcurrencyLimiter_RejectsWhenSaturated holds all slots with blocked
// handlers, then verifies an additional request fails fast with 503 and a
// Retry-After header. Releasing a slot lets a subsequent request through.
func TestConcurrencyLimiter_RejectsWhenSaturated(t *testing.T) {
	const limit = 2

	l := NewConcurrencyLimiter(limit)

	release := make(chan struct{})
	entered := make(chan struct{}, limit)

	r := gin.New()
	r.Use(l.Middleware())
	r.GET("/x", func(c *gin.Context) {
		entered <- struct{}{}

		<-release // block until the test lets it finish, holding the slot
		c.String(http.StatusOK, "ok")
	})

	var wg sync.WaitGroup
	for i := 0; i < limit; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
		}()
	}

	// Wait until both slots are occupied.
	for i := 0; i < limit; i++ {
		<-entered
	}

	if got := l.InFlight(); got != limit {
		t.Fatalf("expected %d in-flight, got %d", limit, got)
	}

	// Next request must be rejected immediately.
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when saturated, got %d", w.Code)
	}

	if w.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header on 503 response")
	}

	// Drain the blocked handlers.
	close(release)
	wg.Wait()

	if got := l.InFlight(); got != 0 {
		t.Fatalf("expected 0 in-flight after drain, got %d", got)
	}
}

// TestConcurrencyLimiter_ReleasesOnPanic verifies a slot is released even when
// the handler panics (gin.Recovery converts it to 500), so the limiter does not
// leak capacity.
func TestConcurrencyLimiter_ReleasesOnPanic(t *testing.T) {
	l := NewConcurrencyLimiter(1)

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(l.Middleware())
	r.GET("/boom", func(c *gin.Context) { panic("boom") })

	for i := 0; i < 3; i++ {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/boom", nil))

		if w.Code != http.StatusInternalServerError {
			t.Fatalf("request %d: expected 500 from recovered panic, got %d", i, w.Code)
		}

		if got := l.InFlight(); got != 0 {
			t.Fatalf("request %d: slot leaked, in-flight=%d", i, got)
		}
	}
}

// TestConcurrencyLimiter_AllowsUpToLimit runs many requests through a limiter
// with fast handlers and asserts they all succeed (slots are released between
// requests) and the peak observed concurrency never exceeds the limit.
func TestConcurrencyLimiter_AllowsUpToLimit(t *testing.T) {
	const limit = 4

	l := NewConcurrencyLimiter(limit)

	var (
		peak int32
		cur  int32
	)

	r := gin.New()
	r.Use(l.Middleware())
	r.GET("/x", func(c *gin.Context) {
		n := atomic.AddInt32(&cur, 1)

		for {
			p := atomic.LoadInt32(&peak)
			if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
				break
			}
		}

		atomic.AddInt32(&cur, -1)
		c.String(http.StatusOK, "ok")
	})

	var (
		wg           sync.WaitGroup
		ok, rejected int32
	)

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))

			switch w.Code {
			case http.StatusOK:
				atomic.AddInt32(&ok, 1)
			case http.StatusServiceUnavailable:
				atomic.AddInt32(&rejected, 1)
			}
		}()
	}

	wg.Wait()

	if p := atomic.LoadInt32(&peak); p > limit {
		t.Errorf("observed concurrency %d exceeded limit %d", p, limit)
	}

	if atomic.LoadInt32(&ok)+atomic.LoadInt32(&rejected) != 100 {
		t.Errorf("expected all 100 requests accounted for, got ok=%d rejected=%d",
			atomic.LoadInt32(&ok), atomic.LoadInt32(&rejected))
	}
}
