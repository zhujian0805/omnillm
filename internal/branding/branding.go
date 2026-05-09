// Package branding holds shared branding assets (logo, product name) that
// can be imported by any internal package without creating import cycles.
package branding

// Logo is the ASCII art banner displayed in the TUI when no messages exist yet.
const Logo = `
   ____  _   _       _      ____          _
  / __ \| \ | |     / \    / ___|___   __| | ___
 | |  | |  \| |    / _ \  | |   / _ \ / _` + "`" + ` |/ _ \
 | |__| | |\  |   / ___ \ | |__| (_) | (_| |  __/
  \____/|_| \_|  /_/   \_\ \____\___/ \__,_|\___|
`
