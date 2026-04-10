package commands

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"omnimodel/internal/database"
	ghservice "omnimodel/internal/services/github"
)

var CheckUsageCmd = &cobra.Command{
	Use:   "check-usage",
	Short: "Check GitHub Copilot usage and quota",
	RunE: func(cmd *cobra.Command, args []string) error {
		// Initialize database
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %w", err)
		}
		configDir := filepath.Join(homeDir, ".local", "share", "omnimodel")
		if err := database.InitializeDatabase(configDir); err != nil {
			return fmt.Errorf("failed to initialize database: %w", err)
		}

		// Find stored GitHub token
		tokenStore := database.NewTokenStore()
		tokens, err := tokenStore.GetAllByProvider("github-copilot")
		if err != nil || len(tokens) == 0 {
			return fmt.Errorf("no authenticated GitHub Copilot provider found. Run 'omnimodel auth' first")
		}

		// Use the first token
		var githubToken string
		for _, t := range tokens {
			var tokenData map[string]interface{}
			if err := json.Unmarshal([]byte(t.TokenData), &tokenData); err == nil {
				if gt, ok := tokenData["github_token"].(string); ok {
					githubToken = gt
					break
				}
			}
		}

		if githubToken == "" {
			return fmt.Errorf("no GitHub token found. Run 'omnimodel auth' first")
		}

		usage, err := ghservice.GetCopilotUsage(githubToken)
		if err != nil {
			return fmt.Errorf("failed to get usage: %w", err)
		}

		fmt.Println("Copilot Usage:")
		fmt.Println("─────────────")

		for key, val := range usage {
			fmt.Printf("  %s: %v\n", key, val)
		}

		return nil
	},
}
