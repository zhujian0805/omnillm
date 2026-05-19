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

type checkRow struct {
	ok    bool
	label string
	value string
}

func printChecks(out io.Writer, rows []checkRow) error {
	maxLabel := 0
	for _, r := range rows {
		if len([]rune(r.label)) > maxLabel {
			maxLabel = len([]rune(r.label))
		}
	}
	for _, r := range rows {
		icon := "✓"
		if !r.ok {
			icon = "✗"
		}
		label := r.label + ":"
		if _, err := fmt.Fprintf(out, "  %s  %s  %s\n", icon, padRightRunes(label, maxLabel+1), r.value); err != nil {
			return err
		}
	}
	return nil
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
	apiKeyFile := filepath.Join(configDir, "api-key")

	configOK := true
	if _, err := os.Stat(configDir); os.IsNotExist(err) {
		configOK = false
		if nextStep == "" {
			nextStep = "Run 'omnillm start' to initialise the configuration directory."
		}
	}

	dbValue := dbPath + " (not found — will be created on first start)"
	dbOK := false
	if info, err := os.Stat(dbPath); err == nil {
		dbOK = true
		dbValue = fmt.Sprintf("%s (%d bytes)", dbPath, info.Size())
	}

	apiKeyOK := true
	if _, err := os.Stat(apiKeyFile); os.IsNotExist(err) {
		apiKeyOK = false
	}
	apiKeyValue := apiKeyFile
	if !apiKeyOK {
		apiKeyValue = "not found (will be generated on start)"
	}

	if err := printChecks(out, []checkRow{
		{ok: configOK, label: "Config directory", value: configDir},
		{ok: dbOK, label: "Database", value: dbValue},
		{ok: apiKeyOK, label: "API key file", value: apiKeyValue},
	}); err != nil {
		return err
	}

	fmt.Fprintln(out)

	// ── Server reachability ───────────────────────────────────────────────────
	if err := PrintSection(out, "Server"); err != nil {
		return err
	}

	c := NewClient(cmd)
	apiKeyConfigured := c.APIKey != ""
	apiKeyStatus := "configured"
	if !apiKeyConfigured {
		apiKeyStatus = "not set (use --api-key or OMNILLM_API_KEY)"
	}

	serverChecks := []checkRow{
		{ok: true, label: "Server address", value: c.BaseURL},
		{ok: apiKeyConfigured, label: "API key", value: apiKeyStatus},
	}

	serverOK := false
	var statusResp map[string]interface{}
	start := time.Now()
	statusData, err := c.Get("/api/admin/status")
	latency := time.Since(start)
	if err != nil {
		serverChecks = append(serverChecks, checkRow{ok: false, label: "Server reachable", value: fmt.Sprintf("NO — %v", err)})
		if nextStep == "" {
			nextStep = "Run 'omnillm start' to start the server."
		}
	} else {
		serverOK = true
		serverChecks = append(serverChecks, checkRow{ok: true, label: "Server reachable", value: fmt.Sprintf("yes (%dms)", latency.Milliseconds())})
		_ = json.Unmarshal(statusData, &statusResp)
	}

	if err := printChecks(out, serverChecks); err != nil {
		return err
	}

	if serverOK && statusResp != nil {
		fmt.Fprintln(out)
		if err := PrintSection(out, "Server status"); err != nil {
			return err
		}
		status, _ := statusResp["status"].(string)
		uptime, _ := statusResp["uptime"].(string)
		modelCount, _ := statusResp["modelCount"].(float64)

		statusOK := status == "ok" || status == "running" || status == "healthy"
		if err := printChecks(out, []checkRow{
			{ok: statusOK, label: "Status", value: status},
		}); err != nil {
			return err
		}
		if err := PrintKeyValueSection(out, [][2]string{
			{"Uptime", uptime},
			{"Models", fmt.Sprintf("%.0f", modelCount)},
		}); err != nil {
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
			provChecks := []checkRow{
				{ok: providerOK, label: "Providers configured", value: fmt.Sprintf("%d total, %d active", len(providers), activeCount)},
			}
			if !providerOK && nextStep == "" {
				nextStep = "Run 'omnillm auth' to add and authenticate a provider."
			} else if activeCount == 0 && len(providers) > 0 && nextStep == "" {
				nextStep = "Run 'omnillm provider activate <id>' to activate a provider."
			}

			vmData, vmErr := c.Get("/api/admin/virtualmodels")
			if vmErr == nil {
				var vmResp map[string]interface{}
				if jsonErr := json.Unmarshal(vmData, &vmResp); jsonErr == nil {
					items, _ := vmResp["data"].([]interface{})
					provChecks = append(provChecks, checkRow{ok: true, label: "Virtual models", value: fmt.Sprintf("%d configured", len(items))})
				}
			}

			if err := printChecks(out, provChecks); err != nil {
				return err
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
					if err := printChecks(out, []checkRow{
						{ok: false, label: "Auth in progress", value: fmt.Sprintf("%s (%s)", providerID, authStatus)},
					}); err != nil {
						return err
					}
					kvPairs := [][2]string{}
					if userCode, ok := authResp["userCode"].(string); ok && userCode != "" {
						kvPairs = append(kvPairs, [2]string{"User code", userCode})
					}
					if url, ok := authResp["instructionURL"].(string); ok && url != "" {
						kvPairs = append(kvPairs, [2]string{"Visit", url})
					}
					if len(kvPairs) > 0 {
						if err := PrintKeyValueSection(out, kvPairs); err != nil {
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
		if _, err := fmt.Fprintf(out, "Next step: %s\n", nextStep); err != nil {
			return err
		}
	} else {
		if _, err := fmt.Fprintln(out, "Everything looks good. ✓"); err != nil {
			return err
		}
	}

	return nil
}