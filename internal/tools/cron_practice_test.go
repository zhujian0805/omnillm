package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestScheduleHeartbeatCreatesTaskEntry(t *testing.T) {
	tool := ScheduleHeartbeat()
	store := NewTaskStore()
	input, _ := json.Marshal(map[string]any{
		"interval_seconds": 30,
		"prompt":           "check queue depth",
		"target":           "ops-worker",
	})
	res := tool.Execute(context.Background(), Context{TaskStore: store}, input)
	if res.IsError {
		t.Fatalf("unexpected error: %s", res.Output)
	}
	if !strings.Contains(res.Output, "Job ID:") {
		t.Fatalf("expected job id in output: %q", res.Output)
	}
	if len(store.list()) != 1 {
		t.Fatalf("expected one task entry, got %d", len(store.list()))
	}
}

func TestTriggerEventDispatchesToWorkerWhenAvailable(t *testing.T) {
	tool := TriggerEvent()
	var targetSeen, messageSeen string
	ctx := Context{
		SendMessageFn: func(_ context.Context, to, message string) (string, error) {
			targetSeen = to
			messageSeen = message
			return "ack", nil
		},
	}
	input, _ := json.Marshal(map[string]any{
		"event_type": "build.failed",
		"payload":    "service=api",
		"target":     "incident-worker",
	})
	res := tool.Execute(context.Background(), ctx, input)
	if res.IsError {
		t.Fatalf("unexpected error: %s", res.Output)
	}
	if targetSeen != "incident-worker" {
		t.Fatalf("unexpected dispatch target: %q", targetSeen)
	}
	if !strings.Contains(messageSeen, "build.failed") {
		t.Fatalf("unexpected dispatched message: %q", messageSeen)
	}
}

func TestTriggerEventFallsBackToTaskStore(t *testing.T) {
	tool := TriggerEvent()
	store := NewTaskStore()
	input, _ := json.Marshal(map[string]any{"event_type": "deploy.completed"})
	res := tool.Execute(context.Background(), Context{TaskStore: store}, input)
	if res.IsError {
		t.Fatalf("unexpected error: %s", res.Output)
	}
	if len(store.list()) != 1 {
		t.Fatalf("expected one queued event task, got %d", len(store.list()))
	}
}
