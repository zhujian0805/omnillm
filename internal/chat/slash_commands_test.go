package chat

import "testing"

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
