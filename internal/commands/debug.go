package commands

import (
	"fmt"
	"omnillm/internal/database"
	"os"
	"path/filepath"
	"runtime"

	"github.com/spf13/cobra"
)

var DebugCmd = &cobra.Command{
	Use:   "debug",
	Short: "Print debug information about the runtime and configuration",
	RunE: func(cmd *cobra.Command, args []string) error {
		out := cmd.OutOrStdout()

		fmt.Fprintln(out, "OmniLLM Debug Info")
		fmt.Fprintln(out, "════════════════════")
		fmt.Fprintln(out)

		// Runtime info
		fmt.Fprintln(out, "Runtime:")
		fmt.Fprintf(out, "  Go version: %s\n", runtime.Version())
		fmt.Fprintf(out, "  OS/Arch:    %s/%s\n", runtime.GOOS, runtime.GOARCH)
		fmt.Fprintf(out, "  NumCPU:     %d\n", runtime.NumCPU())
		fmt.Fprintln(out)

		// Paths
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %w", err)
		}
		configDir := filepath.Join(homeDir, ".config", "omnillm")
		dbPath := filepath.Join(configDir, "database.sqlite")

		fmt.Fprintln(out, "Paths:")
		fmt.Fprintf(out, "  Home:     %s\n", homeDir)
		fmt.Fprintf(out, "  Config:   %s\n", configDir)
		fmt.Fprintf(out, "  Database: %s\n", dbPath)

		// Check if database exists
		if _, err := os.Stat(dbPath); os.IsNotExist(err) {
			fmt.Fprintln(out, "  Database: NOT FOUND")
		} else {
			info, _ := os.Stat(dbPath)
			fmt.Fprintf(out, "  DB Size:  %d bytes\n", info.Size())
		}
		fmt.Fprintln(out)

		// Token status
		if err := database.InitializeDatabase(configDir); err != nil {
			fmt.Fprintf(out, "  Database error: %v\n", err)
			return nil
		}

		tokenStore := database.NewTokenStore()
		tokens, err := tokenStore.GetAllByProvider("github-copilot")
		if err != nil {
			fmt.Fprintf(out, "  Token error: %v\n", err)
		} else {
			fmt.Fprintln(out, "Tokens:")
			if len(tokens) == 0 {
				fmt.Fprintln(out, "  No tokens stored. Run 'omnillm auth' to authenticate.")
			}
			for _, t := range tokens {
				fmt.Fprintf(out, "  Instance: %s\n", t.InstanceID)
			}
		}
		fmt.Fprintln(out)

		// Provider instances
		instanceStore := database.NewProviderInstanceStore()
		instances, err := instanceStore.GetAll()
		if err != nil {
			fmt.Fprintf(out, "  Instance error: %v\n", err)
		} else {
			fmt.Fprintln(out, "Provider Instances:")
			if len(instances) == 0 {
				fmt.Fprintln(out, "  No provider instances stored.")
			}
			for _, inst := range instances {
				activated := "inactive"
				if inst.Activated {
					activated = "active"
				}
				fmt.Fprintf(out, "  %s [%s] priority=%d (%s)\n", inst.InstanceID, inst.ProviderID, inst.Priority, activated)
			}
		}

		return nil
	},
}
