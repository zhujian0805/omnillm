package chat

import (
	"strings"
	"testing"
)

func TestSlashCommandsCatalogShape(t *testing.T) {
	cmds := slashCommands()
	if len(cmds) == 0 {
		t.Fatalf("slashCommands() returned empty catalog")
	}

	seen := map[string]bool{}
	for _, c := range cmds {
		if c.Name == "" || c.Name[0] != '/' {
			t.Errorf("invalid command name %q", c.Name)
		}
		if c.Summary == "" {
			t.Errorf("command %q has empty summary", c.Name)
		}
		if seen[c.Name] {
			t.Errorf("duplicate command name %q", c.Name)
		}
		seen[c.Name] = true
		for _, a := range c.Aliases {
			if seen[a] {
				t.Errorf("duplicate alias %q on %q", a, c.Name)
			}
			seen[a] = true
		}
	}

	for _, must := range []string{"/help", "/new", "/sessions", "/session", "/mode", "/apishape", "/permissions", "/model", "/agent", "/max-turns", "/models", "/spec", "/clear", "/quit"} {
		if !seen[must] {
			t.Errorf("catalog missing required command %q", must)
		}
	}
}

func TestFuzzySlashFilter(t *testing.T) {
	all := slashCommands()

	cases := []struct {
		name    string
		filter  string
		want    []string
		notWant []string
	}{
		{name: "empty returns all", filter: "", want: []string{"/help"}},
		{name: "leading slash only returns all", filter: "/", want: []string{"/help"}},
		{name: "prefix match", filter: "/mo", want: []string{"/mode", "/model", "/models"}},
		{name: "no leading slash still matches", filter: "mo", want: []string{"/mode", "/model", "/models"}},
		{name: "question mark alias", filter: "?", want: []string{"/help"}},
		{name: "no match", filter: "/zzzz", notWant: []string{"/help"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := fuzzySlashFilter(all, tc.filter)
			if tc.filter == "" || tc.filter == "/" {
				if len(got) != len(all) {
					t.Fatalf("filter %q: want all %d, got %d", tc.filter, len(all), len(got))
				}
				return
			}
			if len(tc.want) > 0 && len(got) < len(tc.want) {
				t.Fatalf("filter %q: want at least %v, got %v", tc.filter, tc.want, slashNames(got))
			}
			for i, name := range tc.want {
				if got[i].Name != name {
					t.Errorf("filter %q: position %d want %q got %q (full=%v)", tc.filter, i, name, got[i].Name, slashNames(got))
				}
			}
			for _, nw := range tc.notWant {
				for _, g := range got {
					if g.Name == nw {
						t.Errorf("filter %q: did not want %q", tc.filter, nw)
					}
				}
			}
		})
	}
}

func slashNames(cs []slashCommand) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.Name
	}
	return out
}

func TestRenderSlashHelp(t *testing.T) {
	out := renderSlashHelp(slashCommands())
	for _, want := range []string{"/help", "/models", "/quit", "show available commands"} {
		if !strings.Contains(out, want) {
			t.Errorf("renderSlashHelp output missing %q\n---\n%s", want, out)
		}
	}
	if !strings.HasPrefix(strings.TrimSpace(out), "**Commands:**") {
		t.Errorf("renderSlashHelp output should start with **Commands:** header; got:\n%s", out)
	}
}
