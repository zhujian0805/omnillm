package virtualmodelrouting

// Additional tests for virtual-model load-balancing strategies and edge cases
// not covered by the baseline virtualmouting_test.go file.

import (
	"omnillm/internal/database"
	"testing"
)

// ─── SelectUpstream ──────────────────────────────────────────────────────────

func TestSelectUpstreamReturnsSingleUpstream(t *testing.T) {
	upstream := database.VirtualModelUpstreamRecord{ProviderID: "p1", ModelID: "m1"}
	got := SelectUpstream([]database.VirtualModelUpstreamRecord{upstream}, database.LbStrategyPriority, "vm")
	if got == nil {
		t.Fatal("expected non-nil upstream")
	}
	if got.ProviderID != "p1" {
		t.Errorf("expected p1, got %q", got.ProviderID)
	}
}

func TestSelectUpstreamReturnsDifferentPointerEachCall(t *testing.T) {
	// Returned pointer must not alias the input slice element.
	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "p1", ModelID: "m1"},
	}
	got := SelectUpstream(upstreams, database.LbStrategyPriority, "vm")
	if got == nil {
		t.Fatal("expected non-nil")
	}
	got.ProviderID = "mutated"
	if upstreams[0].ProviderID != "p1" {
		t.Error("SelectUpstream returned a pointer into the original slice")
	}
}

// ─── Round-robin ─────────────────────────────────────────────────────────────

func TestOrderUpstreamsRoundRobinWrapsAround(t *testing.T) {
	resetRoundRobinState()

	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "a"},
		{ProviderID: "b"},
	}

	calls := make([]string, 6)
	for i := range calls {
		result := OrderUpstreams(upstreams, database.LbStrategyRoundRobin, "vm-wrap")
		calls[i] = result[0].ProviderID
	}

	// Expected: a, b, a, b, a, b
	for i, got := range calls {
		var want string
		if i%2 == 0 {
			want = "a"
		} else {
			want = "b"
		}
		if got != want {
			t.Errorf("call %d: expected %q, got %q", i, want, got)
		}
	}
}

func TestOrderUpstreamsRoundRobinIsolatedByVirtualModelID(t *testing.T) {
	resetRoundRobinState()

	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "x"},
		{ProviderID: "y"},
	}

	// Advance vm-A twice
	OrderUpstreams(upstreams, database.LbStrategyRoundRobin, "vm-A")
	OrderUpstreams(upstreams, database.LbStrategyRoundRobin, "vm-A")

	// vm-B should start from the beginning
	first := OrderUpstreams(upstreams, database.LbStrategyRoundRobin, "vm-B")
	if first[0].ProviderID != "x" {
		t.Errorf("vm-B should start at index 0, got %q", first[0].ProviderID)
	}
}

// ─── Weighted ────────────────────────────────────────────────────────────────

func TestOrderUpstreamsWeightedAllSameWeight(t *testing.T) {
	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "a", Weight: 1},
		{ProviderID: "b", Weight: 1},
		{ProviderID: "c", Weight: 1},
	}

	seen := map[string]int{}
	for range 300 {
		result := OrderUpstreams(upstreams, database.LbStrategyWeighted, "vm-w")
		seen[result[0].ProviderID]++
	}

	// Each provider should be selected roughly 1/3 of the time.
	// With 300 trials the probability of any provider seeing < 50 is vanishingly small.
	for _, p := range []string{"a", "b", "c"} {
		if seen[p] < 50 {
			t.Errorf("provider %q selected only %d/300 times — weighted distribution looks wrong", p, seen[p])
		}
	}
}

func TestOrderUpstreamsWeightedZeroWeightCountsAsOne(t *testing.T) {
	// Weight=0 must be treated as weight=1 (not cause divide-by-zero).
	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "zero", Weight: 0},
		{ProviderID: "one", Weight: 1},
	}
	for range 20 {
		result := OrderUpstreams(upstreams, database.LbStrategyWeighted, "vm-z")
		if len(result) != 2 {
			t.Fatalf("expected 2 results, got %d", len(result))
		}
	}
}

func TestOrderUpstreamsWeightedSkewedDistribution(t *testing.T) {
	// Provider "heavy" should win ~90% of the time.
	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "heavy", Weight: 9},
		{ProviderID: "light", Weight: 1},
	}
	heavy := 0
	const trials = 1000
	for range trials {
		result := OrderUpstreams(upstreams, database.LbStrategyWeighted, "vm-skew")
		if result[0].ProviderID == "heavy" {
			heavy++
		}
	}
	// Expect between 80% and 99% heavy selections
	if heavy < 800 || heavy > 990 {
		t.Errorf("skewed distribution out of expected range: heavy=%d/%d", heavy, trials)
	}
}

// ─── Random ──────────────────────────────────────────────────────────────────

func TestOrderUpstreamsRandomEventuallySelectsAll(t *testing.T) {
	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "r1"},
		{ProviderID: "r2"},
		{ProviderID: "r3"},
	}
	seen := map[string]bool{}
	for range 200 {
		result := OrderUpstreams(upstreams, database.LbStrategyRandom, "vm-rand")
		seen[result[0].ProviderID] = true
	}
	for _, p := range []string{"r1", "r2", "r3"} {
		if !seen[p] {
			t.Errorf("provider %q was never selected in 200 random trials", p)
		}
	}
}

func TestOrderUpstreamsRandomReturnsCopy(t *testing.T) {
	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "orig1"},
		{ProviderID: "orig2"},
	}
	result := OrderUpstreams(upstreams, database.LbStrategyRandom, "vm")
	result[0].ProviderID = "mutated"
	if upstreams[0].ProviderID == "mutated" || upstreams[1].ProviderID == "mutated" {
		t.Error("OrderUpstreams(random) mutated the original slice")
	}
}

// ─── Priority ────────────────────────────────────────────────────────────────

func TestOrderUpstreamsPriorityAlwaysReturnsSameOrder(t *testing.T) {
	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "first", Priority: 0},
		{ProviderID: "second", Priority: 1},
		{ProviderID: "third", Priority: 2},
	}
	for range 10 {
		result := OrderUpstreams(upstreams, database.LbStrategyPriority, "vm")
		if result[0].ProviderID != "first" || result[1].ProviderID != "second" || result[2].ProviderID != "third" {
			t.Errorf("priority order changed: %v", result)
		}
	}
}

func TestOrderUpstreamsPriorityReturnsCopy(t *testing.T) {
	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "pa"},
		{ProviderID: "pb"},
	}
	result := OrderUpstreams(upstreams, database.LbStrategyPriority, "vm")
	result[0].ProviderID = "mutated"
	if upstreams[0].ProviderID == "mutated" {
		t.Error("OrderUpstreams(priority) mutated the original slice")
	}
}

// ─── Edge cases ──────────────────────────────────────────────────────────────

func TestOrderUpstreamsSingleEntryAllStrategies(t *testing.T) {
	upstreams := []database.VirtualModelUpstreamRecord{{ProviderID: "solo", ModelID: "m"}}
	for _, strategy := range []database.LbStrategy{
		database.LbStrategyRoundRobin,
		database.LbStrategyRandom,
		database.LbStrategyPriority,
		database.LbStrategyWeighted,
	} {
		result := OrderUpstreams(upstreams, strategy, "vm")
		if len(result) != 1 || result[0].ProviderID != "solo" {
			t.Errorf("strategy %q: expected solo provider, got %v", strategy, result)
		}
	}
}

func TestOrderUpstreamsAllStrategiesReturnAllUpstreams(t *testing.T) {
	upstreams := []database.VirtualModelUpstreamRecord{
		{ProviderID: "a", Weight: 1},
		{ProviderID: "b", Weight: 1},
		{ProviderID: "c", Weight: 1},
	}
	for _, strategy := range []database.LbStrategy{
		database.LbStrategyRoundRobin,
		database.LbStrategyRandom,
		database.LbStrategyPriority,
		database.LbStrategyWeighted,
	} {
		result := OrderUpstreams(upstreams, strategy, "vm-count")
		if len(result) != 3 {
			t.Errorf("strategy %q: expected 3 results, got %d", strategy, len(result))
		}
		// Every original provider must appear exactly once
		seen := map[string]int{}
		for _, r := range result {
			seen[r.ProviderID]++
		}
		for _, p := range []string{"a", "b", "c"} {
			if seen[p] != 1 {
				t.Errorf("strategy %q: provider %q appeared %d times", strategy, p, seen[p])
			}
		}
	}
}
