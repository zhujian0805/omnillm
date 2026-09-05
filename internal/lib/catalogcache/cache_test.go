package catalogcache

import (
	"bytes"
	"errors"
	"omnillm/internal/lib/catalogstate"
	"omnillm/internal/providers/types"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func catalog(id string) *types.ModelsResponse {
	return &types.ModelsResponse{Data: []types.Model{{ID: id}}}
}

func TestCatalogDiagnosticsExcludeUpstreamPayload(t *testing.T) {
	var output bytes.Buffer
	previous := log.Logger
	log.Logger = zerolog.New(&output).Level(zerolog.DebugLevel)
	t.Cleanup(func() { log.Logger = previous })
	c := New(time.Minute, 0)
	_, _ = c.Get("diagnostic-provider", "mock", func() (*types.ModelsResponse, error) { return nil, errors.New("SECRET_CATALOG_BODY") })
	text := output.String()
	if bytes.Contains(output.Bytes(), []byte("SECRET_CATALOG_BODY")) {
		t.Fatal("upstream payload leaked")
	}
	for _, field := range []string{"diagnostic-provider", "catalog_source", "degraded", "model_count", "lifecycle", "refresh"} {
		if !bytes.Contains([]byte(text), []byte(field)) {
			t.Fatalf("missing diagnostic %s", field)
		}
	}
}

func TestExpiryFailureBackoffAndRecovery(t *testing.T) {
	now := time.Now()
	c := New(time.Minute, time.Hour)
	c.now = func() time.Time { return now }
	var calls int
	fetch := func() (*types.ModelsResponse, error) { calls++; return catalog("astra"), nil }
	_, _ = c.Get("expiry", "openai", fetch)
	now = now.Add(time.Minute)
	failure := func() (*types.ModelsResponse, error) { calls++; return nil, &TransientError{} }
	got, err := c.Get("expiry", "openai", failure)
	if err != nil || !got.Degraded || got.Data[0].ID != "astra" {
		t.Fatalf("last good: %+v %v", got, err)
	}
	_, _ = c.Get("expiry", "openai", fetch)
	if calls != 2 {
		t.Fatalf("backoff calls=%d", calls)
	}
	now = now.Add(30 * time.Second)
	got, err = c.Get("expiry", "openai", fetch)
	if err != nil || got.Degraded || calls != 3 {
		t.Fatalf("recovery %+v %v calls=%d", got, err, calls)
	}
}

func TestEmptyNilAndDegradedRecover(t *testing.T) {
	for _, response := range []*types.ModelsResponse{nil, {}, {Data: []types.Model{{ID: "fallback"}}, Degraded: true}} {
		now := time.Now()
		c := New(time.Minute, 0)
		c.now = func() time.Time { return now }
		_, _ = c.Get("degraded", "mock", func() (*types.ModelsResponse, error) { return response, nil })
		now = now.Add(30 * time.Second)
		got, err := c.Get("degraded", "mock", func() (*types.ModelsResponse, error) { return catalog("astra"), nil })
		if err != nil || got.Data[0].ID != "astra" {
			t.Fatalf("recovery %+v %v", got, err)
		}
	}
}

func TestMaximumStaleAgeAndAuthenticationFailure(t *testing.T) {
	for _, auth := range []bool{false, true} {
		now := time.Now()
		c := New(time.Minute, time.Hour)
		c.now = func() time.Time { return now }
		_, _ = c.Get("stale", "mock", func() (*types.ModelsResponse, error) { return catalog("astra"), nil })
		now = now.Add(time.Hour)
		if auth {
			now = now.Add(-59 * time.Minute)
		}
		got, err := c.Get("stale", "mock", func() (*types.ModelsResponse, error) {
			if auth {
				return nil, errors.New("unauthorized")
			}
			return nil, &TransientError{}
		})
		if err == nil || got != nil {
			t.Fatalf("obsolete catalog retained: %+v %v", got, err)
		}
	}
}

func TestInvalidationFencesInflightFetchAndDoesNotBlockOtherProviders(t *testing.T) {
	for _, invalidate := range []func(string){catalogstate.Invalidate, catalogstate.Refresh} {
		c := New(time.Minute, time.Hour)
		started := make(chan struct{})
		release := make(chan struct{})
		done := make(chan struct{})
		go func() {
			defer close(done)
			_, _ = c.Get("race", "mock", func() (*types.ModelsResponse, error) { close(started); <-release; return catalog("old"), nil })
		}()
		<-started
		_, _ = c.Get("independent", "mock", func() (*types.ModelsResponse, error) { return catalog("independent"), nil })
		invalidate("race")
		got, _ := c.Get("race", "mock", func() (*types.ModelsResponse, error) { return catalog("new"), nil })
		if got.Data[0].ID != "new" {
			t.Fatal("refresh blocked")
		}
		close(release)
		<-done
		got, _ = c.Get("race", "mock", func() (*types.ModelsResponse, error) { t.Fatal("unexpected fetch"); return nil, nil })
		if got.Data[0].ID != "new" {
			t.Fatal("stale fetch overwrote refresh")
		}
	}
}

func TestConcurrentFetchCoalesces(t *testing.T) {
	c := New(time.Minute, 0)
	var calls atomic.Int32
	var wg sync.WaitGroup
	start := make(chan struct{})
	release := make(chan struct{})
	for range 20 {
		wg.Go(func() {
			<-start
			_, _ = c.Get("concurrent", "mock", func() (*types.ModelsResponse, error) { calls.Add(1); <-release; return catalog("astra"), nil })
		})
	}
	close(start)
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("fetches=%d", calls.Load())
	}
}

func TestFreshExpiryTypeIsolationAndSnapshotCopies(t *testing.T) {
	now := time.Now()
	c := New(5*time.Minute, 0)
	c.now = func() time.Time { return now }
	calls := 0
	fetch := func() (*types.ModelsResponse, error) { calls++; return catalog("astra"), nil }
	first, _ := c.Get("types", "old-type", fetch)
	first.Data[0].ID = "mutated"
	got, _ := c.Get("types", "old-type", fetch)
	if got.Data[0].ID != "astra" || calls != 1 {
		t.Fatal("caller mutated snapshot")
	}
	_, _ = c.Get("types", "new-type", fetch)
	if calls != 2 {
		t.Fatal("provider type reused old catalog")
	}
	now = now.Add(5 * time.Minute)
	_, _ = c.Get("types", "new-type", fetch)
	if calls != 3 {
		t.Fatal("catalog did not expire")
	}
}
