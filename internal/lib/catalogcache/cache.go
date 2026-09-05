// Package catalogcache provides bounded, versioned provider catalog snapshots.
package catalogcache

import (
	"errors"
	"fmt"
	"maps"
	"omnillm/internal/lib/catalogstate"
	"omnillm/internal/providers/types"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

const RetryInterval = 30 * time.Second

// TransientError permits bounded last-good reuse. Error bodies are deliberately excluded.
type TransientError struct{ Status int }

func (e *TransientError) Error() string {
	return fmt.Sprintf("temporary model discovery failure (status %d)", e.Status)
}

type entry struct {
	version        catalogstate.Version
	response, good *types.ModelsResponse
	err            error
	fetched, next  time.Time
	done           chan struct{}
}
type key struct{ id, kind string }
type Cache struct {
	mu            sync.Mutex
	entries       map[key]*entry
	ttl, maxStale time.Duration
	now           func() time.Time
}

func New(ttl, maxStale time.Duration) *Cache {
	return &Cache{entries: make(map[key]*entry), ttl: ttl, maxStale: maxStale, now: time.Now}
}

func clone(r *types.ModelsResponse) *types.ModelsResponse {
	if r == nil {
		return nil
	}
	out := *r
	out.Data = append([]types.Model(nil), r.Data...)
	for i := range out.Data {
		out.Data[i].Capabilities = maps.Clone(out.Data[i].Capabilities)
	}
	return &out
}

// Get coalesces per-provider work without holding a global lock during discovery.
func (c *Cache) Get(id, kind string, fetch func() (*types.ModelsResponse, error)) (*types.ModelsResponse, error) {
	k := key{id, kind}
	for {
		c.mu.Lock()
		version := catalogstate.Current(id)
		now := c.now()
		previous := c.entries[k]
		if previous != nil && previous.version == version {
			if previous.done != nil {
				done := previous.done
				c.mu.Unlock()
				<-done
				continue
			}
			if now.Before(previous.next) {
				if previous.response != nil && previous.response.Degraded && previous.response.Source == "last-good" && !now.Before(previous.fetched.Add(c.maxStale)) {
					c.mu.Unlock()
					return nil, &TransientError{}
				}
				response, err := clone(previous.response), previous.err
				c.mu.Unlock()
				return response, err
			}
		}
		pending := &entry{version: version, done: make(chan struct{})}
		if previous != nil && previous.version.Lifecycle == version.Lifecycle {
			pending.good = previous.good
			pending.fetched = previous.fetched
		}
		c.entries[k] = pending
		c.mu.Unlock()
		response, err := fetch()
		c.mu.Lock()
		now = c.now()
		if catalogstate.Current(id) != version || c.entries[k] != pending {
			close(pending.done)
			pending.done = nil
			c.mu.Unlock()
			return nil, errors.New("provider catalog changed during discovery; retry request")
		}
		usable := response != nil && len(response.Data) > 0
		if err == nil && usable && !response.Degraded {
			pending.good = clone(response)
			pending.fetched = now
			pending.next = now.Add(c.ttl)
		} else {
			pending.next = now.Add(RetryInterval)
			var transient *TransientError
			if errors.As(err, &transient) && pending.good != nil && c.maxStale > 0 && now.Before(pending.fetched.Add(c.maxStale)) {
				response = clone(pending.good)
				response.Degraded = true
				response.Source = "last-good"
				err = nil
			} else {
				// Do not resurrect data following authentication, malformed catalogs, or other non-transient failures.
				pending.good = nil
				if response != nil {
					response = clone(response)
					response.Degraded = true
				}
				if !usable && err == nil {
					err = errors.New("model discovery returned no usable models")
				}
			}
		}
		pending.response = clone(response)
		pending.err = err
		count := 0
		source := "unavailable"
		if response != nil {
			count = len(response.Data)
			source = response.Source
			if source == "" {
				source = "provider"
			}
		}
		log.Debug().Str("provider", id).Str("catalog_source", source).
			Uint64("lifecycle", version.Lifecycle).Uint64("refresh", version.Refresh).
			Int("model_count", count).Bool("degraded", err != nil || response == nil || response.Degraded).
			Msg("Provider catalog discovery completed")
		close(pending.done)
		pending.done = nil
		c.mu.Unlock()
		return clone(response), err
	}
}
