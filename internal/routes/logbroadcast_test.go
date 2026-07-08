package routes

import (
	"testing"
)

// TestHasLogSubscribers_TracksCount verifies the lock-free subscriber-count
// fast path used by the logging hot path to skip formatting when nobody is
// listening.
func TestHasLogSubscribers_TracksCount(t *testing.T) {
	// Ensure a clean starting state (other tests may run in the same binary).
	logSubscribersMu.Lock()
	for sub := range logSubscribers {
		delete(logSubscribers, sub)
	}

	logSubscriberCount.Store(int32(len(logSubscribers)))
	logSubscribersMu.Unlock()

	if HasLogSubscribers() {
		t.Fatal("expected no subscribers initially")
	}

	sub := &logSubscriber{ch: make(chan string, 4), done: make(chan struct{})}

	logSubscribersMu.Lock()
	logSubscribers[sub] = struct{}{}
	logSubscriberCount.Store(int32(len(logSubscribers)))
	logSubscribersMu.Unlock()

	if !HasLogSubscribers() {
		t.Fatal("expected HasLogSubscribers to report true after registration")
	}

	// A broadcast should now reach the subscriber's channel.
	BroadcastLogLine("hello")

	select {
	case got := <-sub.ch:
		if got == "" {
			t.Fatal("expected non-empty SSE data on subscriber channel")
		}
	default:
		t.Fatal("expected broadcast to be delivered to the subscriber")
	}

	// Deregister and confirm the fast path reports no subscribers again.
	logSubscribersMu.Lock()
	delete(logSubscribers, sub)
	logSubscriberCount.Store(int32(len(logSubscribers)))
	logSubscribersMu.Unlock()

	if HasLogSubscribers() {
		t.Fatal("expected no subscribers after deregistration")
	}
}

// TestBroadcastLogLine_NoSubscribersIsNoop verifies BroadcastLogLine returns
// without panicking (and without work) when there are no subscribers.
func TestBroadcastLogLine_NoSubscribersIsNoop(t *testing.T) {
	logSubscribersMu.Lock()
	for sub := range logSubscribers {
		delete(logSubscribers, sub)
	}

	logSubscriberCount.Store(int32(len(logSubscribers)))
	logSubscribersMu.Unlock()

	// Must be a safe no-op.
	BroadcastLogLine("nobody is listening")
}
