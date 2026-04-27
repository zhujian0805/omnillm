package commands

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

var ChatCmd = &cobra.Command{
	Use:   "chat",
	Short: "Interactive chat or manage chat sessions",
	Long: `Start an interactive chat session or manage saved sessions.

Running 'omnillm chat' without subcommands launches an interactive REPL
that sends messages to the active provider via the proxy.`,
	RunE: runInteractiveChat,
}

var chatSessionsCmd = &cobra.Command{
	Use:   "sessions",
	Short: "Manage saved chat sessions",
}

func init() {
	// sessions subcommands
	chatSessionsCmd.AddCommand(chatSessionsListCmd)

	chatSessionsCreateCmd.Flags().String("title", "", "Session title")
	chatSessionsCreateCmd.Flags().String("model", "", "Model ID to use for the session")
	chatSessionsCreateCmd.Flags().String("api-shape", "openai", "API shape (openai|anthropic)")
	chatSessionsCmd.AddCommand(chatSessionsCreateCmd)

	chatSessionsCmd.AddCommand(chatSessionsGetCmd)

	chatSessionsRenameCmd.Flags().String("title", "", "New title (required)")
	chatSessionsCmd.AddCommand(chatSessionsRenameCmd)

	chatSessionsDeleteCmd.Flags().BoolP("all", "a", false, "Delete all sessions")
	chatSessionsDeleteCmd.Flags().BoolP("yes", "y", false, "Skip confirmation")
	chatSessionsCmd.AddCommand(chatSessionsDeleteCmd)

	ChatCmd.AddCommand(chatSessionsCmd)

	// send subcommand
	chatSendCmd.Flags().String("role", "user", "Message role: user|assistant|system")
	ChatCmd.AddCommand(chatSendCmd)

	// interactive flags
	ChatCmd.Flags().String("model", "", "Model to use for the chat session")
	ChatCmd.Flags().String("session", "", "Resume an existing session by ID")
}

// ─── sessions list ────────────────────────────────────────────────────────────

var chatSessionsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List chat sessions",
	RunE: func(cmd *cobra.Command, args []string) error {
		c := NewClient(cmd)
		data, err := c.Get("/api/admin/chat/sessions")
		if err != nil {
			return err
		}
		if c.IsJSON() {
			c.PrintJSON(data)
			return nil
		}

		var resp map[string]interface{}
		if err := json.Unmarshal(data, &resp); err != nil {
			return err
		}
		sessions, _ := resp["sessions"].([]interface{})
		if len(sessions) == 0 {
			fmt.Println("No chat sessions.")
			return nil
		}

		fmt.Printf("%-36s  %-30s  %-30s  %s\n", "SESSION ID", "TITLE", "MODEL", "MESSAGES")
		fmt.Println(strings.Repeat("─", 110))
		for _, s := range sessions {
			session, _ := s.(map[string]interface{})
			id, _ := session["id"].(string)
			title, _ := session["title"].(string)
			model, _ := session["model_id"].(string)
			msgs, _ := session["message_count"].(float64)
			fmt.Printf("%-36s  %-30s  %-30s  %.0f\n",
				padRight(id, 36), padRight(title, 30), padRight(model, 30), msgs)
		}
		return nil
	},
}

// ─── sessions create ──────────────────────────────────────────────────────────

var chatSessionsCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new chat session",
	RunE: func(cmd *cobra.Command, args []string) error {
		title, _ := cmd.Flags().GetString("title")
		model, _ := cmd.Flags().GetString("model")
		apiShape, _ := cmd.Flags().GetString("api-shape")

		body := map[string]interface{}{
			"title":     title,
			"model_id":  model,
			"api_shape": apiShape,
		}
		c := NewClient(cmd)
		data, err := c.Post("/api/admin/chat/sessions", body)
		if err != nil {
			return err
		}
		if c.IsJSON() {
			c.PrintJSON(data)
			return nil
		}
		var resp map[string]interface{}
		if err := json.Unmarshal(data, &resp); err == nil {
			if sid, ok := resp["session_id"].(string); ok {
				SuccessMsg("Session created: %s", sid)
				return nil
			}
		}
		SuccessMsg("Session created.")
		return nil
	},
}

// ─── sessions get ─────────────────────────────────────────────────────────────

var chatSessionsGetCmd = &cobra.Command{
	Use:   "get <session-id>",
	Short: "Show a chat session and its messages",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := NewClient(cmd)
		data, err := c.Get("/api/admin/chat/sessions/" + args[0])
		if err != nil {
			return err
		}
		if c.IsJSON() {
			c.PrintJSON(data)
			return nil
		}

		var session map[string]interface{}
		if err := json.Unmarshal(data, &session); err != nil {
			return err
		}
		title, _ := session["title"].(string)
		model, _ := session["model_id"].(string)
		fmt.Printf("Session: %s\n", args[0])
		fmt.Printf("  Title: %s\n", title)
		fmt.Printf("  Model: %s\n", model)

		if msgs, ok := session["messages"].([]interface{}); ok && len(msgs) > 0 {
			fmt.Printf("\nMessages (%d):\n", len(msgs))
			fmt.Println(strings.Repeat("─", 60))
			for _, m := range msgs {
				msg, _ := m.(map[string]interface{})
				role, _ := msg["role"].(string)
				content, _ := msg["content"].(string)
				ts, _ := msg["created_at"].(string)
				if len(ts) > 10 {
					ts = ts[:10]
				}
				fmt.Printf("[%s] %s: %s\n", ts, strings.ToUpper(role), content)
			}
		} else {
			fmt.Println("\nNo messages.")
		}
		return nil
	},
}

// ─── sessions rename ──────────────────────────────────────────────────────────

var chatSessionsRenameCmd = &cobra.Command{
	Use:   "rename <session-id> <new-title>",
	Short: "Rename a chat session",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		c := NewClient(cmd)
		body := map[string]string{"title": args[1]}
		data, err := c.Put("/api/admin/chat/sessions/"+args[0], body)
		if err != nil {
			return err
		}
		if c.IsJSON() {
			c.PrintJSON(data)
			return nil
		}
		SuccessMsg("Session '%s' renamed.", args[0])
		return nil
	},
}

// ─── sessions delete ──────────────────────────────────────────────────────────

var chatSessionsDeleteCmd = &cobra.Command{
	Use:   "delete [session-id]",
	Short: "Delete a chat session (or all with --all)",
	RunE: func(cmd *cobra.Command, args []string) error {
		all, _ := cmd.Flags().GetBool("all")
		yes, _ := cmd.Flags().GetBool("yes")
		c := NewClient(cmd)

		if all {
			if !yes && !Confirm("Delete all chat sessions?") {
				fmt.Println("Cancelled.")
				return nil
			}
			data, err := c.Delete("/api/admin/chat/sessions")
			if err != nil {
				return err
			}
			if c.IsJSON() {
				c.PrintJSON(data)
				return nil
			}
			SuccessMsg("All sessions deleted.")
			return nil
		}

		if len(args) == 0 {
			return fmt.Errorf("provide a session-id or use --all")
		}
		if !yes && !Confirm(fmt.Sprintf("Delete session '%s'?", args[0])) {
			fmt.Println("Cancelled.")
			return nil
		}
		data, err := c.Delete("/api/admin/chat/sessions/" + args[0])
		if err != nil {
			return err
		}
		if c.IsJSON() {
			c.PrintJSON(data)
			return nil
		}
		SuccessMsg("Session '%s' deleted.", args[0])
		return nil
	},
}

// ─── send ─────────────────────────────────────────────────────────────────────

var chatSendCmd = &cobra.Command{
	Use:   "send <session-id> <message>",
	Short: "Append a message to a chat session",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		role, _ := cmd.Flags().GetString("role")
		c := NewClient(cmd)
		body := map[string]string{
			"role":    role,
			"content": args[1],
		}
		data, err := c.Post("/api/admin/chat/sessions/"+args[0]+"/messages", body)
		if err != nil {
			return err
		}
		if c.IsJSON() {
			c.PrintJSON(data)
			return nil
		}
		var resp map[string]interface{}
		if err := json.Unmarshal(data, &resp); err == nil {
			if msgID, ok := resp["message_id"].(string); ok {
				SuccessMsg("Message added: %s", msgID)
				return nil
			}
		}
		SuccessMsg("Message added.")
		return nil
	},
}

// ─── interactive REPL ────────────────────────────────────────────────────────

func runInteractiveChat(cmd *cobra.Command, args []string) error {
	c := NewClient(cmd)
	model, _ := cmd.Flags().GetString("model")
	existingSession, _ := cmd.Flags().GetString("session")

	// Determine session ID
	sessionID := existingSession
	if sessionID == "" {
		// Create a new session
		title := "CLI session"
		body := map[string]interface{}{
			"title":     title,
			"model_id":  model,
			"api_shape": "openai",
		}
		data, err := c.Post("/api/admin/chat/sessions", body)
		if err != nil {
			return fmt.Errorf("create session: %w", err)
		}
		var resp map[string]interface{}
		if err := json.Unmarshal(data, &resp); err != nil {
			return err
		}
		sid, ok := resp["session_id"].(string)
		if !ok {
			return fmt.Errorf("server did not return a session_id")
		}
		sessionID = sid
		fmt.Printf("Started session: %s\n", sessionID)
	} else {
		fmt.Printf("Resuming session: %s\n", sessionID)
	}

	fmt.Println("Type your message and press Enter. Type /quit or /exit to quit.")
	fmt.Println()

	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Print("You: ")
		if !scanner.Scan() {
			break
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if line == "/quit" || line == "/exit" || line == "exit" || line == "quit" {
			fmt.Println("Goodbye.")
			break
		}

		// Store user message
		msgBody := map[string]string{"role": "user", "content": line}
		if _, err := c.Post("/api/admin/chat/sessions/"+sessionID+"/messages", msgBody); err != nil {
			ErrorMsg("store message: %v", err)
			continue
		}

		// Send to /v1/chat/completions for a real LLM response
		// Build a minimal OpenAI-style request using all session messages
		sessionData, err := c.Get("/api/admin/chat/sessions/" + sessionID)
		if err != nil {
			ErrorMsg("load session: %v", err)
			continue
		}
		var session map[string]interface{}
		if err := json.Unmarshal(sessionData, &session); err != nil {
			ErrorMsg("parse session: %v", err)
			continue
		}

		// Collect messages
		type chatMsg struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}
		var messages []chatMsg
		if msgs, ok := session["messages"].([]interface{}); ok {
			for _, m := range msgs {
				msg, _ := m.(map[string]interface{})
				role, _ := msg["role"].(string)
				content, _ := msg["content"].(string)
				messages = append(messages, chatMsg{Role: role, Content: content})
			}
		}

		reqModel := model
		if reqModel == "" {
			if mid, ok := session["model_id"].(string); ok && mid != "" {
				reqModel = mid
			} else {
				reqModel = "gpt-4"
			}
		}

		completionBody := map[string]interface{}{
			"model":    reqModel,
			"messages": messages,
			"stream":   false,
		}

		respData, err := c.Post("/v1/chat/completions", completionBody)
		if err != nil {
			ErrorMsg("completion: %v", err)
			continue
		}

		var completion map[string]interface{}
		if err := json.Unmarshal(respData, &completion); err != nil {
			fmt.Println(string(respData))
			continue
		}

		// Extract assistant reply
		assistantContent := ""
		if choices, ok := completion["choices"].([]interface{}); ok && len(choices) > 0 {
			choice, _ := choices[0].(map[string]interface{})
			if message, ok := choice["message"].(map[string]interface{}); ok {
				assistantContent, _ = message["content"].(string)
			}
		}

		if assistantContent == "" {
			fmt.Println("(no response)")
			continue
		}

		fmt.Printf("Assistant: %s\n\n", assistantContent)

		// Store assistant reply in session
		aBody := map[string]string{"role": "assistant", "content": assistantContent}
		if _, err := c.Post("/api/admin/chat/sessions/"+sessionID+"/messages", aBody); err != nil {
			// Non-fatal — just log
			ErrorMsg("store assistant message: %v", err)
		}
	}

	return scanner.Err()
}
