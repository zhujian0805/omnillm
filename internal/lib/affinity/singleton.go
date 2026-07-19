package affinity

import "sync"

var (
	singletonOnce sync.Once
	singleton     *Cache
	singletonMu   sync.RWMutex
)

// Get returns the process-wide affinity cache, lazily initialised with
// DefaultConfig on first use. Callers on the hot path use Get().Lookup / Record.
func Get() *Cache {
	singletonOnce.Do(func() {
		singletonMu.Lock()
		if singleton == nil {
			singleton = NewCache(DefaultConfig())
		}
		singletonMu.Unlock()
	})
	singletonMu.RLock()
	defer singletonMu.RUnlock()
	return singleton
}

// Configure replaces the process-wide cache with one built from cfg. Intended to
// be called once at startup after config is loaded, before serving traffic.
func Configure(cfg Config) {
	singletonMu.Lock()
	singleton = NewCache(cfg)
	singletonMu.Unlock()
	// Ensure Get()'s Once is consumed so it doesn't overwrite our instance.
	singletonOnce.Do(func() {})
}
