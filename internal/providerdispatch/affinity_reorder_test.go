package providerdispatch

import (
	"testing"

	"omnillm/internal/providers/types"
)

type fakeProvider struct {
	types.Provider
	id string
}

func (f fakeProvider) GetInstanceID() string { return f.id }

func ids(ps []types.Provider) []string {
	out := make([]string, len(ps))
	for i, p := range ps {
		out[i] = p.GetInstanceID()
	}
	return out
}

func TestMoveInstanceToFront(t *testing.T) {
	mk := func(names ...string) []types.Provider {
		ps := make([]types.Provider, len(names))
		for i, n := range names {
			ps[i] = fakeProvider{id: n}
		}
		return ps
	}

	cases := []struct {
		name string
		in   []string
		inst string
		want []string
	}{
		{"hit_middle", []string{"a", "b", "c"}, "b", []string{"b", "a", "c"}},
		{"hit_last", []string{"a", "b", "c"}, "c", []string{"c", "a", "b"}},
		{"already_front", []string{"a", "b", "c"}, "a", []string{"a", "b", "c"}},
		{"not_present", []string{"a", "b", "c"}, "z", []string{"a", "b", "c"}},
		{"empty_inst", []string{"a", "b"}, "", []string{"a", "b"}},
		{"single", []string{"a"}, "a", []string{"a"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ids(moveInstanceToFront(mk(tc.in...), tc.inst))
			if len(got) != len(tc.want) {
				t.Fatalf("len mismatch: got %v want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("got %v want %v", got, tc.want)
				}
			}
		})
	}
}
