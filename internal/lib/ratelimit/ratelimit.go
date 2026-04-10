// Package ratelimit provides rate limiting functionality
package ratelimit

import (
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

type RateLimiter struct {
	mu              sync.Mutex
	intervalSeconds int
	waitOnLimit     bool
	lastRequestTime *time.Time
}

func NewRateLimiter(intervalSeconds int, waitOnLimit bool) *RateLimiter {
	return &RateLimiter{
		intervalSeconds: intervalSeconds,
		waitOnLimit:     waitOnLimit,
	}
}

func (rl *RateLimiter) CheckAndWait() error {
	if rl.intervalSeconds <= 0 {
		return nil
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	if rl.lastRequestTime == nil {
		rl.lastRequestTime = &now
		return nil
	}

	elapsed := now.Sub(*rl.lastRequestTime)
	requiredInterval := time.Duration(rl.intervalSeconds) * time.Second

	if elapsed >= requiredInterval {
		rl.lastRequestTime = &now
		return nil
	}

	waitTime := requiredInterval - elapsed

	if !rl.waitOnLimit {
		log.Warn().
			Float64("elapsed_seconds", elapsed.Seconds()).
			Float64("required_seconds", requiredInterval.Seconds()).
			Msg("Rate limit exceeded")
		return fmt.Errorf("rate limit exceeded. Need to wait %v more", waitTime)
	}

	// Release lock while sleeping to not block other goroutines
	rl.mu.Unlock()

	log.Warn().
		Float64("wait_seconds", waitTime.Seconds()).
		Msg("Rate limit reached. Waiting before proceeding...")

	time.Sleep(waitTime)

	rl.mu.Lock()
	nowAfterWait := time.Now()
	rl.lastRequestTime = &nowAfterWait

	log.Info().Msg("Rate limit wait completed, proceeding with request")
	return nil
}

func (rl *RateLimiter) GetIntervalSeconds() int {
	return rl.intervalSeconds
}

func (rl *RateLimiter) GetWaitOnLimit() bool {
	return rl.waitOnLimit
}
