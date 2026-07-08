package kimi

import (
	"sync"
	"testing"
	"time"
)

// TestProviderConcurrentReadWrite exercises the lock-guarded auth/config fields
// under concurrent readers and writers to surface data races under -race.
//
// It avoids the database entirely: configOnce is tripped up-front so
// ensureConfig() becomes a no-op, and writes go through applyConfig/SetName
// (which never touch the token store).
func TestProviderConcurrentReadWrite(t *testing.T) {
	p := NewProvider("test-rw", "")
	// Trip configOnce so ensureConfig() does not hit the (uninitialized) DB.
	p.configOnce.Do(func() {})

	p.mu.Lock()
	p.token = "seed-token"
	p.baseURL = "https://api.moonshot.cn/v1"
	p.config = map[string]any{"auth_type": "api-key"}
	p.mu.Unlock()

	var wg sync.WaitGroup

	stop := make(chan struct{})

	// Readers: hot-path getters.
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
					_ = p.GetConfig()
					_ = p.GetHeaders(false)
				}
			}
		})
	}

	// Writers: config merge + name updates.
	for range 4 {
		wg.Go(func() {
			for {
				select {
				case <-stop:
					return
				default:
					p.applyConfig(map[string]any{"base_url": "https://api.moonshot.cn/v1"})
					p.SetName("Kimi")
				}
			}
		})
	}

	time.Sleep(100 * time.Millisecond)
	close(stop)
	wg.Wait()
}
