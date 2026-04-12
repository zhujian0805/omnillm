#!/usr/bin/env bash
# Cross-platform release script — delegates to release.ts
# Works on Linux, macOS, and Windows (Git Bash / WSL)
exec "$(dirname "$0")/release.ts" "$@"
