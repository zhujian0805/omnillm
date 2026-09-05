## 1. Specification and approval

- [x] Trace the exact failure, cache layers, lifecycle paths, and existing tests.
- [x] Prepare proposal, delta specs, design, and evidence with incident limitations.
- [x] Run `bun run spec:validate` with strict validation passing (15 passed, 0 failed).
- [x] Obtain human approval of proposal, delta specs, design, and tasks before implementation (user approved and requested live tests).

## 2. Regression coverage before implementation

- [x] Add failing cache tests for bounded expiry, nil/empty/degraded discovery,
  transient outage and recovery, concurrent fetch coalescing, and retry backoff.
- [x] Add failing lifecycle/refresh tests for provider replacement, account/config
  change, type change, rename/delete/recreate, and invalidation during a fetch.
- [x] Add OpenAI mock-transport coverage for expired last-good catalog retention,
  maximum stale age, authentication failure, forced refresh, and exact Astra identity.
- [x] Add route/admin integration regressions proving refresh updates generation
  routing and fallback data is not persisted as successful discovery.

## 3. Implementation

- [x] Introduce shared discovery degradation/freshness handling and migrate affected
  OpenAI, Copilot, compatible, and Alibaba producers and consumers.
- [x] Implement bounded routing caching, OpenAI-owned freshness, per-provider
  coalescing/backoff, and bounded transient last-good OpenAI fallback.
- [x] Wire lifecycle invalidation and fence stale in-flight publications.
- [x] Wire admin forced refresh through provider-local and generation catalog layers.
- [x] Preserve exact OpenAI identifiers while retaining explicit legacy mappings.
- [x] Add metadata-only catalog diagnostics and verify payload/credential exclusion.

## 4. Verification and archive

- [x] Run targeted Go tests for affected catalog, provider, registry, dispatch, and routes packages.
- [x] Verify all three generation dialects and deterministic five-tool-loop fixtures
  for Claude Code, Codex CLI, Droid, and GitHub Copilot CLI custom-provider mode.
- [x] Run available isolated live coding-client smokes; record five call/result
  pairs, terminal continuation, exit status, or a concrete skip reason per client.
- [x] Run `bun run spec:check`, `bun run lint:all`, `bun run typecheck`, `bun test`,
  and `bun run build`; record failures without marking unchecked work complete.
- [x] Run `go vet ./...`, `go build ./...`, and `go test -race ./...`.
- [x] Record verification results and compare exact upstream model identity with baseline.
- [x] Confirm approval, implementation, and all prior checks pass before archiving.
  Archive with the OpenSpec command and re-run spec checks as the final lifecycle operation.
