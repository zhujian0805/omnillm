package codex

import (
	"sync"
	"testing"
	"time"
)

// TestGetToken_APIKeyFastPath verifies that with API-key auth GetToken returns
// the key directly and never attempts a network refresh. Exercised from many
// goroutines to surface data races under -race.
func TestGetToken_APIKeyFastPath(t *testing.T) {
	p := NewCodexProvider("test-apikey")
	p.apiKey = "sk-test"
	p.baseURL = codexBaseURL

	const goroutines = 30

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for range goroutines {
		go func() {
			defer wg.Done()

			if got := p.GetToken(); got != "sk-test" {
				t.Errorf("GetToken returned %q, want sk-test", got)
			}
		}()
	}

	wg.Wait()
}

// TestGetToken_ConcurrentReadWrite exercises the token getters (readers)
// against concurrent SetName/GetBaseURL/GetHeaders (writers/readers) to surface
// data races under -race on the shared mutable fields. Uses the API-key path so
// no network call is made.
func TestGetToken_ConcurrentReadWrite(t *testing.T) {
	p := NewCodexProvider("test-rw")
	p.apiKey = "sk-test"
	p.baseURL = codexBaseURL

	var wg sync.WaitGroup

	stop := make(chan struct{})

	for range 8 {
		wg.Go(func() {
			for {
				select {
				case <-stop:
					return
				default:
					_ = p.GetToken()
					_ = p.GetName()
					_ = p.GetBaseURL()
					_ = p.GetHeaders(false)
				}
			}
		})
	}

	for range 4 {
		wg.Go(func() {
			for {
				select {
				case <-stop:
					return
				default:
					p.SetName("codex")
				}
			}
		})
	}

	time.Sleep(100 * time.Millisecond)
	close(stop)
	wg.Wait()
}
