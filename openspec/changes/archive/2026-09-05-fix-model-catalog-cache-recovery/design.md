# Model catalog recovery design

## Context and evidence

The failure happens before upstream generation when dispatch has no prepared
candidates. Generation uses `modelrouting.ModelCache`, OpenAI adds its own
15-minute cache, and the model-list/admin path uses a separate 24-hour SQLite
cache. Redis exact-response cache can bypass routing on a hit but does not own
provider availability. Evidence and alternative explanations are in
[investigation.md](investigation.md).

## Decisions

### 1. Give discovery results an explicit freshness contract

Represent degraded discovery in a shared provider contract, using typed metadata
or a typed error with a usable fallback response. Migrate the existing Alibaba
fallback marker to the shared classification without losing its behavior. Apply
the contract to OpenAI OAuth, Copilot, and compatible endpoint discovery failures.
Configured compatible model IDs remain legitimate configuration, even when the
endpoint has no model-list API. Empty/nil results cannot become successful routing
snapshots. Every consumer must handle usable fallback data explicitly; do not make
the admin path accidentally discard it through its current generic error branch.

Keep the persisted model view's 24-hour default separate from generation freshness.
Routing snapshots have a five-minute maximum reuse interval. For OpenAI, which
already owns catalog caching, delegate to its provider cache instead of wrapping
it in a second freshness interval. Its successful live snapshot remains fresh for
15 minutes. This avoids extending a provider's TTL by layering caches.

### 2. Recover without refresh storms

Coalesce concurrent discovery for the same provider lifecycle and use a 30-second
retry interval after failed discovery. That interval is failure backoff, not a new
successful catalog timestamp. Successful empty results may throttle repeat work
for that interval but must not become an indefinitely authoritative empty cache.
Do not refresh all providers on every arbitrary unknown model name.

For OpenAI transient network failures, 429, or 5xx responses, prefer a last
successful live catalog up to one hour from its original successful fetch time.
Never extend that age when serving stale data. Without such data, keep the built-in
fallback marked degraded. Authentication failures and account/configuration
changes must not reuse a catalog from a previous authorization context. A successful
refresh replaces the snapshot rather than merging removed models indefinitely.

Use a controllable clock and blocking mock transports in tests. Do not hold a
global cache mutex across network I/O; unrelated providers must remain independent.

### 3. Make provider lifecycle and refresh invalidate coherently

Use per-instance lifecycle generations or equivalent versioned ownership to prevent
reuse after replacement, type change, rename, deletion/recreation, configuration
change, or re-authentication. Provider identity alone is insufficient because
configuration and account updates can mutate an existing object.

Capture the lifecycle/cache generation before fetching. Publish a result only if
the generation is still current, so a request started before invalidation cannot
restore obsolete models afterward. Avoid a registry-to-routing import cycle by
placing invalidation coordination in a lower-level catalog component or exposing
the generation through the provider/registry boundary.

Admin refresh must invoke an explicit provider refresh capability where provider
local caches exist. On success it updates the persisted view and replaces or
invalidates the matching generation snapshot before returning. On failure it can
retain the existing degraded display behavior, but cannot label fallback data as a
new successful catalog or overwrite last-good data with it. Persisted model states
remain an overlay, not proof that discovery succeeded.

### 4. Preserve exact model identity

An exact OpenAI model, including Astra, must not become `catalog[0]` merely because
it is absent from a degraded or stale catalog. Preserve explicitly documented
legacy mappings in a finite compatibility table; pass other unknown identifiers
through unchanged after provider selection. Unqualified routing still requires
model availability and must not guess a provider or send arbitrary model names to
every account. Existing explicit provider pinning remains the supported bypass of
catalog membership; the adapter must preserve that pinned model identity.

### 5. Keep recovery observable

Emit catalog source, freshness/degraded status, provider instance, invalidation or
refresh reason, model count, and sanitized error classification at appropriate
levels. No credentials, raw upstream error bodies, or generation payloads belong
in these diagnostics. Retain existing public error envelopes in this fix; typed
distinctions between unknown models and unavailable discovery can be a follow-up.

## Compatibility and rollout

No persistence schema changes or cache-clearing migration are required. Restarting
onto the fixed binary initializes bounded in-memory state. SQLite display cache
keeps its existing default TTL and state overlay. Provider ordering, active-provider
filtering, disabled-model filtering for ordinary resolution, native namespaced IDs,
virtual models, explicit pinning, and failover ordering remain intact.

OpenAI unknown-model passthrough is intentional: an upstream rejection is more
accurate than running an unrelated model. Verify existing documented alias behavior
and generation payload identity. Adding Astra to the static list alone is rejected
because it leaves the failure mechanism intact for the next model.

## Verification

First add failing deterministic regressions for fallback poisoning, expiry,
failure/recovery, forced refresh, provider replacement/account changes, and fetches
that race invalidation. Then implement the cache contract and integration. Mock
upstream generation must assert the exact requested model, including Astra.

Run all three supported generation dialects with response caching disabled so
replay cannot mask stale routing. Reuse coding-agent fixtures for Claude Code,
Codex CLI, Droid, and Copilot CLI custom-provider mode, checking five sequential
native tool calls/results and terminal continuation. Run bounded isolated live
smokes when the client and safe local provider configuration are available; record
concrete reasons for unavailable clients. Required commands are listed in tasks.

## Failure handling and limits

This fix cannot grant a model entitlement, enable an inactive provider, or guarantee
first-request success when no catalog has ever advertised the model and discovery
is down. Recovery is bounded by retry/freshness policy once upstream discovery
recovers. Last-good data is only routing metadata; upstream execution still enforces
actual account access. A successful catalog that omits a model remains authoritative.
