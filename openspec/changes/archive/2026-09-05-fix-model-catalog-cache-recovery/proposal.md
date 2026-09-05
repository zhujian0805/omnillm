# Change: Recover model routing after catalog discovery failures

## Why

Codex intermittently receives `model 'gpt-6-astra' not found or no providers available`.
At baseline `e8505a7`, generation routing memoizes provider catalogs for the process
lifetime. OpenAI OAuth discovery returns its built-in catalog with a nil error on
live discovery failure; that catalog lacks Astra and can therefore poison routing
until restart. Copilot's built-in fallback and compatible endpoints' empty fallback
can be cached in the same way. Admin refresh updates a separate SQLite view and
does not invalidate generation routing. OpenAI remapping can also replace an exact
new model with an older default when discovery degrades.

These are verified source defects, not confirmation of the particular production
incident: the failing process's logs, provider identity, and catalog response have
not been supplied. See [investigation](investigation.md) for evidence and limits.

## What Changes

- Bound generation catalog freshness and scope cached data to provider lifecycle.
- Distinguish live/configured model data from degraded fallback data; do not store
  degraded or unusable data as successful discovery.
- Keep a bounded last successful OpenAI catalog during transient discovery errors,
  with coalesced fetches and bounded retry frequency.
- Make explicit admin refresh bypass provider-local catalog caches and update
  subsequent generation routing; fence concurrent stale publications.
- Preserve explicit OpenAI model IDs during catalog degradation, retaining only
  explicit compatibility mappings rather than substituting arbitrary unknown GPT IDs.
- Add deterministic recovery and client compatibility coverage.

## Capabilities

- `routing-failover`: add bounded catalog freshness, recovery, and lifecycle isolation.
- `providers`: clarify discovery cache scope, fallback provenance, and OpenAI identity.
- `admin-api`: add refresh consistency across discovery and generation routing.

## Runtime Impact

This changes runtime behavior. Model availability recovers without restarting the
gateway after a transient catalog failure. Refresh can issue a real upstream catalog
request and expires obsolete routing information. Unknown OpenAI model IDs reach
the upstream unchanged when explicitly routed, where unsupported IDs may be rejected
instead of silently executing a different model. No database migration is planned.
Response-cache storage and public error envelope changes are outside this change.

## Approval

Human approval received for this proposal, delta specs, design, and tasks. The
user explicitly requested live testing after implementation.
