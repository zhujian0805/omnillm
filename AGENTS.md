# AGENTS.md

## Build, Lint, and Test Commands

- **Build:**  
  `bun run build` (uses tsup)
- **Dev:**  
  `bun run dev`
- **Lint:**  
  `bun run lint` (uses @echristian/eslint-config)
- **Lint & Fix staged files:**  
  `bunx lint-staged`
- **Test all:**  
   `bun test`
- **Test single file:**  
   `bun test tests/claude-request.test.ts`
- **Start (prod):**  
  `bun run start`

## Code Style Guidelines

- **Imports:**  
  Use ESNext syntax. Prefer absolute imports via `~/*` for `src/*` (see `tsconfig.json`).
- **Formatting:**  
  Follows Prettier (with `prettier-plugin-packagejson`). Run `bun run lint` to auto-fix.
- **Types:**  
  Strict TypeScript (`strict: true`). Avoid `any`; use explicit types and interfaces.
- **Naming:**  
  Use `camelCase` for variables/functions, `PascalCase` for types/classes.
- **Error Handling:**  
  Use explicit error classes (see `src/lib/error.ts`). Avoid silent failures.
- **Unused:**  
  Unused imports/variables are errors (`noUnusedLocals`, `noUnusedParameters`).
- **Switches:**  
  No fallthrough in switch statements.
- **Modules:**  
  Use ESNext modules, no CommonJS.
- **Testing:**  
   Use Bun's built-in test runner. Place tests in `tests/`, name as `*.test.ts`.
- **Linting:**  
  Uses `@echristian/eslint-config` (see npm for details). Includes stylistic, unused imports, regex, and package.json rules.
- **Paths:**  
  Use path aliases (`~/*`) for imports from `src/`.

## Critical Change Documentation

- **Every critical change** (breaking API changes, major refactors, critical bug fixes, architecture shifts, provider protocol changes, etc.) must be documented in `docs/` as a markdown file for record.
- **File naming:** Use descriptive names, e.g. `docs/qwen3.6-plus-claude-code-critical-changes.md`, `docs/CIF_MIGRATION.md`.
- **Content convention:** Include context, what changed (before/after), why it's critical, affected files, and commit range. See existing docs for examples.
- **This rule is mandatory:** Do not skip documentation for critical changes, even if the change seems obvious.

---

This file is tailored for agentic coding agents. For more details, see the configs in `eslint.config.js` and `tsconfig.json`. No Cursor or Copilot rules detected.
