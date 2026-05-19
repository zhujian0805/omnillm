package commands

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestTableRenderBordered(t *testing.T) {
	table := NewTable("NAME", "VALUE")
	table.AddRow("alpha", "1")
	table.AddRow("beta", "22")

	var out bytes.Buffer
	if err := table.Render(&out); err != nil {
		t.Fatalf("Render returned error: %v", err)
	}

	rendered := out.String()
	for _, want := range []string{"NAME", "VALUE", "alpha", "beta", "22", "┌", "┤", "└", "│"} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("rendered table missing %q:\n%s", want, rendered)
		}
	}
}

func TestTableRenderNoRows(t *testing.T) {
	table := NewTable("A", "B")
	var out bytes.Buffer
	if err := table.Render(&out); err != nil {
		t.Fatalf("Render returned error: %v", err)
	}
	rendered := out.String()
	// Header row and borders present; no mid-separator without rows
	if !strings.Contains(rendered, "┌") || !strings.Contains(rendered, "└") {
		t.Fatalf("expected border characters, got:\n%s", rendered)
	}
	if strings.Contains(rendered, "├") {
		t.Fatalf("unexpected mid-separator when no rows, got:\n%s", rendered)
	}
}

func TestTableTruncation(t *testing.T) {
	table := NewTable("ID")
	table.SetMaxWidth(0, 10)
	table.AddRow("short")
	table.AddRow("this-is-a-very-long-identifier")

	var out bytes.Buffer
	if err := table.Render(&out); err != nil {
		t.Fatalf("Render returned error: %v", err)
	}

	rendered := out.String()
	if !strings.Contains(rendered, "short") {
		t.Fatalf("expected 'short' unmodified, got:\n%s", rendered)
	}
	if strings.Contains(rendered, "this-is-a-very-long-identifier") {
		t.Fatalf("expected long value to be truncated, got:\n%s", rendered)
	}
	if !strings.Contains(rendered, "…") {
		t.Fatalf("expected truncation ellipsis '…', got:\n%s", rendered)
	}
}

func TestTableWithoutMaxWidthShowsFullValue(t *testing.T) {
	table := NewTable("ID")
	longValue := "this-is-a-very-long-identifier-that-should-remain-visible"
	table.AddRow(longValue)

	var out bytes.Buffer
	if err := table.Render(&out); err != nil {
		t.Fatalf("Render returned error: %v", err)
	}

	rendered := out.String()
	if !strings.Contains(rendered, longValue) {
		t.Fatalf("expected full long value in rendered table, got:\n%s", rendered)
	}
	if strings.Contains(rendered, "…") {
		t.Fatalf("did not expect truncation ellipsis when no max width is set, got:\n%s", rendered)
	}
}

func TestTruncateHelper(t *testing.T) {
	cases := []struct {
		in   string
		max  int
		want string
	}{
		{"hello", 10, "hello"},
		{"hello", 5, "hello"},
		{"hello world", 8, "hello w…"},
		{"hello", 1, "…"},
		{"hello", 0, "…"},
		{"", 5, ""},
	}
	for _, tc := range cases {
		got := truncate(tc.in, tc.max)
		if got != tc.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", tc.in, tc.max, got, tc.want)
		}
	}
}

func TestPrintKeyValueSection(t *testing.T) {
	var out bytes.Buffer
	pairs := [][2]string{
		{"Status", "healthy"},
		{"Model count", "273"},
		{"Manual approve", "no"},
	}
	if err := PrintKeyValueSection(&out, pairs); err != nil {
		t.Fatalf("PrintKeyValueSection returned error: %v", err)
	}

	rendered := out.String()
	// All values must appear
	for _, want := range []string{"Status", "healthy", "Model count", "273", "Manual approve", "no"} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("output missing %q:\n%s", want, rendered)
		}
	}
	// Keys must be left-aligned with uniform padding:
	// "Status        " should be padded to width of "Manual approve" (14)
	lines := strings.Split(strings.TrimRight(rendered, "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d:\n%s", len(lines), rendered)
	}
	// Each line must start with two spaces and contain the key padded to width 14
	if !strings.HasPrefix(lines[0], "  Status        ") {
		t.Errorf("expected line 0 to start with '  Status        ', got %q", lines[0])
	}
	if !strings.HasPrefix(lines[1], "  Model count   ") {
		t.Errorf("expected line 1 to start with '  Model count   ', got %q", lines[1])
	}
}

func TestPrintKeyValue(t *testing.T) {
	var out bytes.Buffer
	if err := PrintKeyValue(&out, "Status", "healthy"); err != nil {
		t.Fatalf("PrintKeyValue returned error: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "Status") || !strings.Contains(got, "healthy") {
		t.Fatalf("PrintKeyValue output missing content: %q", got)
	}
}

func TestPrintEmpty(t *testing.T) {
	var out bytes.Buffer
	if err := PrintEmpty(&out, "chat sessions"); err != nil {
		t.Fatalf("PrintEmpty returned error: %v", err)
	}
	if got := out.String(); got != "No chat sessions.\n" {
		t.Fatalf("PrintEmpty output = %q, want %q", got, "No chat sessions.\n")
	}
}

func TestPrintSection(t *testing.T) {
	var out bytes.Buffer
	if err := PrintSection(&out, "Status"); err != nil {
		t.Fatalf("PrintSection returned error: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "Status\n") || !strings.Contains(got, "──────") {
		t.Fatalf("unexpected section output:\n%s", got)
	}
}

func TestConfirmReadsFromCommandStreams(t *testing.T) {
	cmd := &cobra.Command{}
	cmd.SetIn(strings.NewReader("y\n"))
	var stderr bytes.Buffer
	cmd.SetErr(&stderr)

	if !Confirm(cmd, "Delete provider?") {
		t.Fatal("Confirm returned false, want true")
	}
	if got := stderr.String(); got != "Delete provider? [y/N] " {
		t.Fatalf("stderr prompt = %q, want %q", got, "Delete provider? [y/N] ")
	}
}
