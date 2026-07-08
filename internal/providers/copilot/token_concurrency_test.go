package copilot

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	ghservice "omnillm/internal/services/github"
)

// TestGetToken_ConcurrentRefreshCollapsesHerd verifies that when many requests
// call GetToken() concurrently with an expired token, the singleflight group
// collapses them into a single upstream token exchange (thundering-herd
// protection) rather than firing one refresh per caller.
//
// Run with -race to also assert there is no data race on the token fields.
func TestGetToken_ConcurrentRefreshCollapsesHerd(t *testing.T) {
	var fetchCount atomic.Int32

	p := NewGitHubCopilotProvider("test-herd", "")
	p.githubToken = "gh-token"
	p.token = "expired"
	p.expiresAt = time.Now().Unix() - 10 // already expired → needs refresh
	p.tokenFetcher = func(string) (*ghservice.CopilotTokenResponse, error) {
		fetchCount.Add(1)
		// Simulate network latency so concurrent callers pile up on the group.
		time.Sleep(20 * time.Millisecond)

		return &ghservice.CopilotTokenResponse{
			Token:     "fresh-token",
			ExpiresAt: time.Now().Unix() + 3600,
		}, nil
	}

	const goroutines = 50

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for range goroutines {
		go func() {
			defer wg.Done()

			if got := p.GetToken(); got != "fresh-token" {
				t.Errorf("GetToken returned %q, want fresh-token", got)
			}
		}()
	}

	wg.Wait()

	// The herd of 50 concurrent callers must collapse to a single refresh.
	if n := fetchCount.Load(); n != 1 {
		t.Errorf("expected exactly 1 upstream token refresh, got %d", n)
	}
}

// TestGetToken_ValidTokenNoRefresh verifies the fast path: a still-valid token
// is returned without any upstream call.
func TestGetToken_ValidTokenNoRefresh(t *testing.T) {
	var fetchCount atomic.Int32

	p := NewGitHubCopilotProvider("test-valid", "")
	p.githubToken = "gh-token"
	p.token = "valid-token"
	p.expiresAt = time.Now().Unix() + 3600 // fresh
	p.tokenFetcher = func(string) (*ghservice.CopilotTokenResponse, error) {
		fetchCount.Add(1)
		return &ghservice.CopilotTokenResponse{Token: "new", ExpiresAt: time.Now().Unix() + 3600}, nil
	}

	const goroutines = 20

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for range goroutines {
		go func() {
			defer wg.Done()

			if got := p.GetToken(); got != "valid-token" {
				t.Errorf("GetToken returned %q, want valid-token", got)
			}
		}()
	}

	wg.Wait()

	if n := fetchCount.Load(); n != 0 {
		t.Errorf("expected no refresh for a valid token, got %d", n)
	}
}

// TestGetToken_ConcurrentReadWrite exercises GetToken (readers) against
// concurrent RefreshToken and SetName (writers) to surface data races under
// -race on the shared mutable auth fields.
func TestGetToken_ConcurrentReadWrite(t *testing.T) {
	p := NewGitHubCopilotProvider("test-rw", "")
	p.githubToken = "gh-token"
	p.token = "seed"
	p.expiresAt = time.Now().Unix() + 3600
	p.tokenFetcher = func(string) (*ghservice.CopilotTokenResponse, error) {
		return &ghservice.CopilotTokenResponse{Token: "refreshed", ExpiresAt: time.Now().Unix() + 3600}, nil
	}

	var wg sync.WaitGroup

	stop := make(chan struct{})

	// Readers.
	for range 8 {
		wg.Go(func() {
			for {
				select {
				case <-stop:
					return
				default:
					_ = p.GetToken()
					_ = p.GetName()
				}
			}
		})
	}

	// Writers.
	for i := range 4 {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()

			for {
				select {
				case <-stop:
					return
				default:
					_ = p.RefreshToken()
					p.SetName("name")
				}
			}
		}(i)
	}

	time.Sleep(100 * time.Millisecond)
	close(stop)
	wg.Wait()
}
