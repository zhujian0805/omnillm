# Model catalog recovery verification

Date: 2026-09-05. Base: `e8505a78dec917a38e3f68793713eff4347e1f30`.
Branch: `fix/model-catalog-cache-recovery`.
Human approval was received before implementation, including an explicit request
for live testing. Sanitized live results are in [live-verification.json](live-verification.json).

## Implemented behavior

- Ordinary generation catalog snapshots expire after five minutes. OpenAI owns
  its existing 15-minute interval without an additional outer TTL.
- Nil, empty, and degraded fallback catalogs cannot become successful snapshots.
  A 30-second retry interval bounds repeated discovery failures; concurrent calls
  share discovery per provider/version while unrelated providers remain independent.
- OpenAI retains last-good catalog data for at most one hour from its successful
  fetch on network/429/5xx failures. Authentication or lifecycle changes retire it.
- Provider registration, rename/removal, persisted config/token changes, Copilot
  credential loading, and compatible configuration application invalidate catalog
  ownership. Pre-invalidation fetches cannot publish into a newer version.
- Admin refresh uses the same catalog path as generation and bypasses every layer's
  freshness. Forced degraded refresh returns an error rather than claiming fresh
  discovery; successful persisted catalog data is retained.
- Arbitrary newer OpenAI identifiers, including Astra, are preserved. Five explicit
  historical aliases retain a fixed compatibility mapping to `gpt-5.6-sol` rather
  than depending on catalog order.
- Discovery diagnostics contain provider, catalog source, lifecycle/refresh version,
  model count, and degraded status. A regression verifies upstream error payloads
  are excluded. OpenAI catalog HTTP errors no longer include response-body previews.

## Regression evidence

Before fixing the implementation, the new baseline regressions failed for provider
replacement, empty-catalog recovery, and Astra remapping. The remapping regression
observed `gpt-5.6-sol` instead of `gpt-6-astra`.

Passing coverage includes expiry, failure backoff/recovery, nil/empty/degraded data,
concurrent coalescing, independent provider progress, stale-age limits, auth failure,
forced OpenAI refresh, catalog response isolation, type and lifecycle ownership,
config/token changes, rename/delete/recreate, and invalidation racing a fetch.

Route integration first rejects a missing model from a degraded catalog, refreshes
the provider, then verifies preserved five-call histories for every maintained
coding-client fixture. Existing ordering, filtering, provider-shape and agentic
compatibility suites also pass.

## Live final-build results

The existing service at port 5000 was inspected read-only. Its catalog identified
Copilot as the active Astra provider. Live verification used a separate gateway
process, temporary runtime database, isolated client settings, and dynamically
allocated loopback port **39622**. Only the selected Copilot credential was retained
in temporary gateway state. Exact-response caching was explicitly disabled.

| Client | Calls | Results | Sequential / matching IDs | Terminal response | Exit |
| --- | ---: | ---: | --- | --- | ---: |
| Codex CLI | 5 | 5 | yes | `CATALOG_LIVE_OK` | 0 |
| Claude Code | 5 | 5 | yes | `CATALOG_LIVE_OK` | 0 |
| Droid | 5 | 5 | yes | `CATALOG_LIVE_OK` | 0 |
| GitHub Copilot CLI custom provider | 5 | 5 | yes | `CATALOG_LIVE_OK` | 0 |

Client transcripts were parsed to verify alternating call/result events, matching
IDs, successful results, exactly five calls, and terminal completion. Across the
24 client turns and three direct shape probes, gateway logs contained 27 successful
Astra responses, all with `model_requested = model_used = gpt-6-astra` and the
selected Copilot provider. There were zero exact-response cache hits.

Final-build direct probes:

| Operation | Result |
| --- | --- |
| Authenticated provider model refresh | HTTP 200 |
| Non-streaming Responses | HTTP 200, Astra, expected marker |
| Non-streaming Chat Completions | HTTP 200, Astra, expected marker |
| Non-streaming Anthropic Messages | HTTP 200, Astra, expected marker |

All four client runs exercised streaming. The local Claude CLI emitted an
unrecognized-model warning for Astra, but completed the tool loop successfully.

### Controlled running-process outage

A temporary OpenAI-compatible HTTP provider initially returned HTTP 503 from
`/models`. Its unique probe model produced HTTP 400 on the first generation
request and on an immediate retry. Only one discovery request occurred during
backoff. After recovery and a 31-second wait, the same gateway process returned
HTTP 200 with the exact probe model. Total discovery calls: two. Total upstream
generation calls: one. No restart was performed.

This deliberately uses a controlled local upstream rather than disrupting the
real Copilot service. Copilot/Astra availability and client compatibility were
verified separately against the real provider as described above.

## Required checks

- `bun run spec:check`: strict validation and mandatory gate passed.
- `bun run lint:all`: passed.
- `bun run typecheck`: passed.
- `bun test`: 370 passed, 22 skipped, zero failed; skips are existing suites.
- `bun run build`: passed; existing large-bundle advisory remains.
- `go vet ./...`: passed.
- `go build ./...`: passed.
- `go test -race ./...`: passed for the final code.
- `git diff --check`: passed.

## Anomalies and limits

An early intermediate run observed one failure in the pre-existing OpenAI
concurrent-refresh test (`16` token requests, expected `1`). Its synchronization
allows late callers after the mocked exchange completes. No token-refresh behavior
was changed for that test; the isolated rerun and subsequent full race suites passed.

An earlier live run on port 40214 saw a connection reset on a refresh request even
though the server recorded HTTP 200. One retry succeeded. The final-build refresh
on port 39622 succeeded on its first attempt.

Initial fault-injection setup encountered the existing compatible-provider auth
path not applying its persisted local-endpoint flag to the new in-memory object.
Applying a supported API-format configuration reload exercised the existing
configuration path and enabled the authorized local endpoint. The final outage
proof counted actual HTTP catalog requests; the earlier setup failures are not
counted as recovery evidence.

OpenAI OAuth outage/identity behavior was verified with deterministic mocked
transports; live Astra tests used the locally active Copilot account. The original
user incident cannot be conclusively attributed without its request logs, although
the catalog-poisoning mechanism is reproduced and fixed. This change does not grant
model entitlement or guarantee success while initial discovery remains unavailable.

The normal installed binary and service were not replaced. Deployment requires
building/installing this branch and restarting the normal service once to load it.
