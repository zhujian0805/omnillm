package commands

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"os"

	"github.com/spf13/cobra"
)

var ConfigCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage external tool config files (Claude Code, Codex, etc.)",
}

func init() {
	ConfigCmd.AddCommand(configListCmd)
	ConfigCmd.AddCommand(configGetCmd)

	configSetCmd.Flags().StringP("file", "f", "", "Path to file to read content from")
	configSetCmd.Flags().Bool("stdin", false, "Read content from stdin")
	configSetCmd.MarkFlagsOneRequired("file", "stdin")
	configSetCmd.MarkFlagsMutuallyExclusive("file", "stdin")
	ConfigCmd.AddCommand(configSetCmd)

	configImportCmd.Flags().StringP("file", "f", "", "Path to file to import (required)")
	_ = configImportCmd.MarkFlagRequired("file")
	ConfigCmd.AddCommand(configImportCmd)

	ConfigCmd.AddCommand(configBackupCmd)
}

