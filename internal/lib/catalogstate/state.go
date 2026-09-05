// Package catalogstate coordinates catalog ownership without depending on providers or persistence.
package catalogstate

import "sync"

type Version struct{ Lifecycle, Refresh uint64 }

var state = struct {
	sync.Mutex
	versions map[string]Version
}{versions: make(map[string]Version)}

func Current(id string) Version { state.Lock(); defer state.Unlock(); return state.versions[id] }

// Invalidate retires all data belonging to an account or provider configuration.
func Invalidate(id string) {
	state.Lock()
	defer state.Unlock()
	v := state.versions[id]
	v.Lifecycle++
	state.versions[id] = v
}

// Refresh expires freshness while retaining last-good data for transient failure handling.
func Refresh(id string) {
	state.Lock()
	defer state.Unlock()
	v := state.versions[id]
	v.Refresh++
	state.versions[id] = v
}
