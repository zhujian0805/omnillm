package commands

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
)

// DoctorCmd checks the local environment and server health for the operator.
var DoctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Check configuration and server health",
	Long: `Check the local OmniLLM configuration and running server health.

Verifies:
  - Config directory and database presence
  - Server reachability
  - API key configuration
  - Provider and virtual model counts
  - In-progress authentication flows

Prints a recommended next action at the end.`,
	Example: `  omnillm doctor
  omnillm doctor --server http://127.0.0.1:5000`,
	RunE: runDoctor,
}

func runDoctor(cmd *cobra.Command, args []string) error {
	out := cmd.OutOrStdout()
	nextStep := ""

	if err := PrintSection(out, "OmniLLM Doctor"); err != nil {
		return err
	}
	fmt.Fprintln(out)

	// ── Local config ──────────────────────────────────────────────────────────
	if err := PrintSection(out, "Local configuration"); err != nil {
		return err
	}

	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".config", "omnillm")
	dbPath := filepath.Join(configDir, "database.sqlite")

	if _, err := os.Stat(configDir); os.IsNotExist(err) {
		printCheck(out, false, "Config directory", configDir+" (not found)")
		if nextStep == "" {
			nextStep = "Run 'omnillm start' to initialise the configuration directory."
		}
	} else {
		printCheck(out, true, "Config directory", configDir)
	}

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		printCheck(out, false, "Database", dbPath+" (not found — will be created on first start)")
	} else {
		info, _ := os.Stat(dbPath)
		printCheck(out, true, "Database", fmt.Sprintf("%s (%d bytes)", dbPath, info.Size()))
	}

	apiKeyFile := filepath.Join(configDir, "api-key")
	if _, err := os.Stat(apiKeyFile); os.IsNotExist(err) {
		printCheck(out, false, "API key file", "not found (will be generated on start)")
	} else {
		printCheck(out, true, "API key file", apiKeyFile)
	}

	fmt.Fprintln(out)

	// ── Server reachability ───────────────────────────────────────────────────
	if err := PrintSection(out, "Server"); err != nil {
		return err
	}

	c := NewClient(cmd)
	printCheck(out, true, "Server address", c.BaseURL)
	apiKeyConfigured := c.APIKey != ""
	if apiKeyConfigured {
		printCheck(out, true, "API key", "configured")
	} else {
		printCheck(out, false, "API key", "not set (use --api-key or OMNILLM_API_KEY)")
	}

	serverOK := false
	var statusResp map[string]interface{}
	start := time.Now()
	statusData, err := c.Get("/api/admin/status")
	latency := time.Since(start)
	if err != nil {
		printCheck(out, false, "Server reachable", fmt.Sprintf("NO — %v", err))
		if nextStep == "" {
			nextStep = "Run 'omnillm start' to start the server."
		}
	} else {
		serverOK = true
		printCheck(out, true, "Server reachable", fmt.Sprintf("yes (%dms)", latency.Milliseconds()))
		_ = json.Unmarshal(statusData, &statusResp)
	}

	if serverOK && statusResp != nil {
		fmt.Fprintln(out)
		if err := PrintSection(out, "Server status"); err != nil {
			return err
		}
		status, _ := statusResp["status"].(string)
		uptime, _ := statusResp["uptime"].(string)
		modelCount, _ := statusResp["modelCount"].(float64)
		printCheck(out, status == "ok" || status == "running", "Status", status)
		if err := PrintKeyValue(out, "Uptime", uptime); err != nil {
			return err
		}
		if err := PrintKeyValue(out, "Models", fmt.Sprintf("%.0f", modelCount)); err != nil {
			return err
		}

		// ── Providers ──────────────────────────────────────────────────────────
		fmt.Fprintln(out)
		if err := PrintSection(out, "Providers"); err != nil {
			return err
		}

		providerData, provErr := c.Get("/api/admin/providers")
		if provErr == nil {
			providers, _ := parseProviders(providerData)
			activeCount := 0
			for _, p := range providers {
				if v, ok := p["isActive"].(bool); ok && v {
					activeCount++
				}
			}
			providerOK := len(providers) > 0
			printCheck(out, providerOK, "Providers configured",
				fmt.Sprintf("%d total, %d active", len(providers), activeCount))
			if !providerOK && nextStep == "" {
				nextStep = "Run 'omnillm auth' to add and authenticate a provider."
			} else if activeCount == 0 && len(providers) > 0 && nextStep == "" {
				nextStep = "Run 'omnillm provider activate <id>' to activate a provider."
			}
		}

		// ── Virtual models ─────────────────────────────────────────────────────
		vmData, vmErr := c.Get("/api/admin/virtualmodels")
		if vmErr == nil {
			var vmResp map[string]interface{}
			if jsonErr := json.Unmarshal(vmData, &vmResp); jsonErr == nil {
				items, _ := vmResp["data"].([]interface{})
				printCheck(out, true, "Virtual models", fmt.Sprintf("%d configured", len(items)))
			}
		}

		// ── Auth flow ──────────────────────────────────────────────────────────
		authData, authErr := c.Get("/api/admin/auth-status")
		if authErr == nil {
			var authResp map[string]interface{}
			if jsonErr := json.Unmarshal(authData, &authResp); jsonErr == nil {
				authStatus, _ := authResp["status"].(string)
				if authStatus != "" && authStatus != "idle" {
					fmt.Fprintln(out)
					if err := PrintSection(out, "Active auth flow"); err != nil {
						return err
					}
					providerID, _ := authResp["providerId"].(string)
					printCheck(out, false, "Auth in progress",
						fmt.Sprintf("%s (%s)", providerID, authStatus))
					if userCode, ok := authResp["userCode"].(string); ok && userCode != "" {
						if err := PrintKeyValue(out, "User code", userCode); err != nil {
							return err
						}
					}
					if url, ok := authResp["instructionURL"].(string); ok && url != "" {
						if err := PrintKeyValue(out, "Visit", url); err != nil {
							return err
						}
					}
				}
			}
		}
	}

	// ── Next step ──────────────────────────────────────────────────────────────
	fmt.Fprintln(out)
	if nextStep != "" {
		fmt.Fprintf(out, "Next step: %s\n", nextStep)
	} else {
		fmt.Fprintln(out, "Everything looks good. ✓")
	}

	return nil
}

func printCheck(out io.Writer, ok bool, label, value string) {
	icon := "✓"
	if !ok {
		icon = "✗"
	}
	fmt.Fprintf(out, "  %s  %-22s %s\n", icon, label+":", value)
}

