// Package affinity implements channel (provider-instance) affinity for OmniLLM.
//
// Goal: keep a linear conversation pinned to the same upstream provider instance
// across turns so that upstream prompt-cache (Anthropic / OpenAI cached_tokens)
// stays warm, cutting input-token cost on multi-turn agent workloads.
//
// The affinity key is derived from the conversation *prefix* (system prompt +
// all messages except the final one). Requests sharing a prefix belong to the
// same cache chain and should therefore prefer the same instance.
//
// Affinity only re-orders the candidate list — it never locks. If the pinned
// instance is gone or fails, dispatch falls through to normal priority order,
// so fallback correctness is unchanged.
package affinity

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"
	"time"

	"omnillm/internal/cif"
)

// Config controls affinity behaviour. Zero value is unusable; use DefaultConfig.
type Config struct {
	Enabled       bool
	TTL           time.Duration
	MaxEntries    int
	IncludeUserID bool
}

// DefaultConfig returns production defaults (enabled, 30m TTL, 50k entries).
func DefaultConfig() Config {
	return Config{
		Enabled:       true,
		TTL:           30 * time.Minute,
		MaxEntries:    50_000,
		IncludeUserID: true,
	}
}

type entry struct {
	instanceID string
	expiresAt  time.Time
}

// Cache is a bounded, TTL'd map from conversation-prefix hash to instance ID.
// Eviction is size-bounded (oldest-write pruned) plus lazy TTL on read.
type Cache struct {
	mu   sync.Mutex
	cfg  Config
	data map[string]entry
	// insertion order ring for cheap size-bounded eviction
	order []string

	hits   uint64
	misses uint64
}

// NewCache builds a Cache from cfg.
func NewCache(cfg Config) *Cache {
	if cfg.MaxEntries <= 0 {
		cfg.MaxEntries = 50_000
	}
	if cfg.TTL <= 0 {
		cfg.TTL = 30 * time.Minute
	}
	return &Cache{
		cfg:   cfg,
		data:  make(map[string]entry, 1024),
		order: make([]string, 0, 1024),
	}
}

// Enabled reports whether affinity is active.
func (c *Cache) Enabled() bool { return c != nil && c.cfg.Enabled }

// Stats returns hit/miss counters and current size.
func (c *Cache) Stats() (hits, misses uint64, size int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.hits, c.misses, len(c.data)
}

// key builds the affinity cache key for a request. It hashes the STABLE head of
// the conversation: system prompt + the first message. That head is identical
// across every turn of a linear conversation, and it is precisely the prefix
// upstream prompt-cache keys on — so keying on it pins a conversation to one
// instance for its whole lifetime. Returns ("", false) when there's nothing to
// key on yet.
//
// Collision semantics are intentionally benign: two distinct conversations that
// share an identical head hash to the same key and thus prefer the same
// instance — which is exactly what we want, since they share the cacheable
// prefix. Affinity only re-orders candidates, so a collision never harms
// correctness.
func (c *Cache) key(request *cif.CanonicalRequest, requestedModel string) (string, bool) {
	if request == nil || len(request.Messages) == 0 {
		return "", false
	}
	hasSystem := request.SystemPrompt != nil && *request.SystemPrompt != ""

	h := sha256.New()
	h.Write([]byte("m:"))
	h.Write([]byte(requestedModel))
	if c.cfg.IncludeUserID && request.UserID != nil {
		h.Write([]byte("|u:"))
		h.Write([]byte(*request.UserID))
	}
	if hasSystem {
		h.Write([]byte("|s:"))
		h.Write([]byte(*request.SystemPrompt))
	}
	h.Write([]byte("|h:"))
	if b, err := json.Marshal(request.Messages[0]); err == nil {
		h.Write(b)
	}
	return "affinity:v1:" + hex.EncodeToString(h.Sum(nil))[:32], true
}

// Lookup returns the pinned instance ID for request's conversation prefix.
func (c *Cache) Lookup(request *cif.CanonicalRequest, requestedModel string) (string, bool) {
	if !c.Enabled() {
		return "", false
	}
	k, ok := c.key(request, requestedModel)
	if !ok {
		return "", false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e, found := c.data[k]
	if !found {
		c.misses++
		return "", false
	}
	if time.Now().After(e.expiresAt) {
		delete(c.data, k)
		c.misses++
		return "", false
	}
	c.hits++
	return e.instanceID, true
}

// Record pins instanceID for this conversation's stable head key. Called after
// a successful dispatch so subsequent turns of the same conversation reuse the
// same instance.
func (c *Cache) Record(request *cif.CanonicalRequest, requestedModel, instanceID string) {
	if !c.Enabled() || instanceID == "" {
		return
	}
	k, ok := c.key(request, requestedModel)
	if !ok {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.data[k]; !exists {
		c.order = append(c.order, k)
	}
	c.data[k] = entry{instanceID: instanceID, expiresAt: time.Now().Add(c.cfg.TTL)}
	c.evictLocked()
}

// evictLocked prunes oldest entries when over capacity. Caller holds mu.
func (c *Cache) evictLocked() {
	for len(c.data) > c.cfg.MaxEntries && len(c.order) > 0 {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.data, oldest)
	}
}
