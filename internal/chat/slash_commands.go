package chat

// slashCommand describes one built-in TUI slash command.
type slashCommand struct {
	Name      string   // canonical name including leading "/"
	Aliases   []string // optional aliases (e.g. "?" for "/help")
	Summary   string   // one-line description shown in picker and /help
	TakesArgs bool     // true when the command accepts arguments
}

// slashCommands returns the static catalog of built-in slash commands.
// The order is the order in which they are presented in /help and as
// the initial picker order before any filter is applied.
func slashCommands() []slashCommand {
	return []slashCommand{
		{Name: "/help", Aliases: []string{"?"}, Summary: "show available commands"},
		{Name: "/new", TakesArgs: true, Summary: "start a new session [title]"},
		{Name: "/sessions", Summary: "browse and resume a previous session"},
		{Name: "/session", Summary: "show current session info"},
		{Name: "/mode", TakesArgs: true, Summary: "show or switch mode (chat|agent)"},
		{Name: "/apishape", Aliases: []string{"/api-shape"}, TakesArgs: true, Summary: "show or set the agent API request shape"},
		{Name: "/permissions", Summary: "toggle autopilot (auto-approve tool calls)"},
		{Name: "/model", TakesArgs: true, Summary: "show or switch model"},
		{Name: "/agent", TakesArgs: true, Summary: "show or set the agent backend"},
		{Name: "/max-turns", TakesArgs: true, Summary: "show or set max agent turns (1-100)"},
		{Name: "/models", Summary: "open model picker"},
		{Name: "/spec", TakesArgs: true, Summary: "spec-driven workflow commands"},
		{Name: "/clear", Aliases: []string{"/cls"}, Summary: "clear the screen"},
		{Name: "/quit", Aliases: []string{"/exit"}, Summary: "quit"},
	}
}
