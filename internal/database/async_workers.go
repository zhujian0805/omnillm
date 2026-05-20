package database

import (
	"sync"

	"github.com/rs/zerolog/log"
)

// asyncWorkers holds the bounded channel-based worker pools for fire-and-forget
// database writes that must never block or slow down the request path.
//
// Both pools are started once via StartAsyncWorkers (called from database init)
// and drained via StopAsyncWorkers (called from server shutdown).
var asyncWorkers struct {
	mu      sync.Mutex
	metering chan MeteringRecord
	lastUsed chan string // access token ID
	wg      sync.WaitGroup
	running bool
}

const (
	meteringBufSize = 4096
	lastUsedBufSize = 4096
	meteringWorkers = 4
	lastUsedWorkers = 2
)

// StartAsyncWorkers starts the bounded background worker pools.
// If workers are already running they are stopped first (supports re-init in tests).
func StartAsyncWorkers() {
	asyncWorkers.mu.Lock()
	defer asyncWorkers.mu.Unlock()

	// Stop any previously running workers (e.g. test re-init).
	if asyncWorkers.running {
		stopWorkersLocked()
	}

	asyncWorkers.metering = make(chan MeteringRecord, meteringBufSize)
	asyncWorkers.lastUsed = make(chan string, lastUsedBufSize)
	asyncWorkers.running = true

	for range meteringWorkers {
		asyncWorkers.wg.Add(1)
		go func() {
			defer asyncWorkers.wg.Done()
			db := GetDatabase()
			for rec := range asyncWorkers.metering {
				if err := db.InsertMeteringRecord(rec); err != nil {
					log.Error().Err(err).Str("request_id", rec.RequestID).Msg("Failed to record metering data")
				}
			}
		}()
	}

	for range lastUsedWorkers {
		asyncWorkers.wg.Add(1)
		go func() {
			defer asyncWorkers.wg.Done()
			db := GetDatabase()
			for id := range asyncWorkers.lastUsed {
				if _, err := db.db.Exec(`UPDATE access_tokens SET last_used_at = datetime('now') WHERE id = ?`, id); err != nil {
					log.Debug().Err(err).Str("token_id", id).Msg("Failed to stamp access token last_used_at")
				}
			}
		}()
	}
}

// StopAsyncWorkers closes both worker channels and waits for all pending
// writes to finish. Call from server shutdown.
func StopAsyncWorkers() {
	asyncWorkers.mu.Lock()
	defer asyncWorkers.mu.Unlock()
	stopWorkersLocked()
}

func stopWorkersLocked() {
	if !asyncWorkers.running {
		return
	}
	asyncWorkers.running = false
	if asyncWorkers.metering != nil {
		close(asyncWorkers.metering)
		asyncWorkers.metering = nil
	}
	if asyncWorkers.lastUsed != nil {
		close(asyncWorkers.lastUsed)
		asyncWorkers.lastUsed = nil
	}
	asyncWorkers.wg.Wait()
}

// EnqueueMeteringRecord sends rec to the metering worker pool.
// If the buffer is full (overload), the record is dropped and a warning is logged.
func EnqueueMeteringRecord(rec MeteringRecord) {
	asyncWorkers.mu.Lock()
	ch := asyncWorkers.metering
	asyncWorkers.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- rec:
	default:
		log.Warn().Str("request_id", rec.RequestID).Msg("Metering worker pool full, dropping record")
	}
}

// EnqueueLastUsedAt sends an access token ID to the last-used-at worker pool.
// If the buffer is full the update is silently skipped — this is metadata-only.
func EnqueueLastUsedAt(tokenID string) {
	asyncWorkers.mu.Lock()
	ch := asyncWorkers.lastUsed
	asyncWorkers.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- tokenID:
	default:
		// Drop silently; last_used_at is informational only.
	}
}

