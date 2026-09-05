# Investigation: intermittent Astra model resolution failure

This is the pre-implementation research record. The approved implementation and
post-change evidence are recorded in [verification.md](verification.md).

Audience: OmniLLM maintainers and the operator reporting the Codex failure.
Date: 2026-09-05. Examined revision: `e8505a78dec917a38e3f68793713eff4347e1f30`.
Scope: gateway model discovery, cache ownership, dispatch, refresh, and remapping.

## Finding

There is a concrete model-catalog caching defect capable of producing the reported
error. Its role in this specific incident remains unconfirmed without the failing
process's provider identity and logs. This is distinct from Redis response caching.

Generation routing stores the first successful-looking provider catalog forever.
OpenAI OAuth returns its built-in catalog with no error after live discovery
failure, and that built-in catalog does not include `gpt-6-astra`. Consequently,
the fallback can be installed as the process-lifetime routing catalog even after
the upstream catalog recovers. [Routing cache, lines 24–64][routing]
[OpenAI fallback, lines 61–79][openai-models]
[OpenAI model list and GetModels, lines 38–45 and 321–323][openai-provider]

## Verified failure chain

1. A generation request reaches the provider resolver with a cold routing cache.
2. OpenAI's live `/models` fetch fails, is unusable, or lacks usable entries.
   `FetchModels` returns the built-in list; `Provider.GetModels` returns nil error.
3. `GetCachedOrFetchModels` stores that response under the provider instance ID.
   It has no timestamp, TTL, provider-type key, or invalidation method.
4. Astra cannot be found, so resolution returns no candidate providers.
5. `TryAttempts` produces the quoted not-found/no-providers message, and the
   Responses route maps it to HTTP 400 with `invalid_request_error`.
6. Subsequent unqualified requests reuse the same outer catalog without invoking
   OpenAI's own refresh code. Recovery of upstream `/models` alone cannot repair it.

Sources: [routing implementation][routing], [OpenAI discovery][openai-models],
[OpenAI provider][openai-provider], [dispatch attempts][attempts],
[Responses handler][responses]. This chain is established by source inspection;
no new executable reproduction was written before the required human approval.

## Why it can appear intermittent

The initial catalog can succeed in one process and fail in another, or succeed
after one restart and fail after another. Once a degraded list is cached, repeated
unqualified requests in that process should fail consistently for missing models.
If the user observes alternating success and failure in a single unchanged process,
this poisoning path alone is insufficient evidence: response-cache hits, different
routes/virtual models, provider changes, or multiple gateway processes need checking.

OpenAI's own cache expires after 15 minutes, while routing does not. Even when
routing retains Astra, the adapter independently calls discovery during remapping.
If that discovery degrades, `remapAgainst` maps any absent `gpt-*` model to the first
fallback entry, currently `gpt-5.6-sol`. That can produce apparent success with the
wrong upstream model. [OpenAI cache][openai-models] [remapping, lines 67–90][openai-provider]

## Other confirmed weaknesses

| Finding | Evidence | Implication |
| --- | --- | --- |
| Admin refresh bypasses only its persisted view and calls ordinary `GetModels` | [admin catalog loader][admin-loader] | OpenAI's local cache can defeat forced live refresh; generation's cache remains stale |
| Public `/models` uses the admin loader | [model-list route][model-list] | A model can appear in discovery while generation uses another catalog |
| Registry replacement keeps the same instance key | [registry registration][registry] and [routing cache][routing] | New provider/account/configuration can inherit stale routing data |
| Copilot falls back to a built-in list with nil error | [Copilot discovery][copilot] | The same outer-cache poisoning can affect Copilot models |
| Compatible providers return an empty list with nil error on discovery failure when no configured models exist | [compatible discovery][compatible] | An empty catalog can be cached indefinitely |
| Only Alibaba fallback has a special non-cacheable path in routing | [routing cache][routing] | Recovery handling is provider-specific and incomplete |
| Candidate construction errors are skipped | [candidate preparation][prepare] | The same message can also mean candidates existed but none could be prepared |

## Cache distinctions and alternative causes

- **Routing catalog:** in-process, no expiry, instance-ID key; directly determines
  ordinary model availability. [routing][routing]
- **OpenAI catalog:** in-process, 15-minute live-success TTL; fresh invalidation on
  `ApplyTokens` does not invalidate the outer routing cache. [models][openai-models]
  [token application][openai-provider]
- **Displayed catalog:** SQLite, 24-hour default, provider-instance/type scoped,
  plus configured/persisted model-state overlays. [admin loader][admin-loader]
  [SQLite cache][db-cache]
- **Exact response cache:** queried before routing and populated after successful
  generation. Clearing Redis does not clear catalog snapshots; a hit can mask a
  broken route by replaying an older successful response. [Responses route][responses]

Other possible causes include a truly unadvertised model, a disabled model, an
inactive pinned provider, an unroutable virtual upstream, or adapter construction
failure. Entirely absent active providers produce the different resolver error
`no active providers available`. [resolution][routing] [virtual/prefix attempts][resolution]
[candidate preparation][prepare]

## Recommended fix

Implement the accompanying [design](design.md): bounded cache freshness, explicit
degraded discovery, coalesced recovery, lifecycle-aware invalidation, coherent
forced refresh, and exact-model preservation. A static Astra entry alone would
hide one symptom while leaving new models and transient discovery failures broken.

Restarting may clear a poisoned routing catalog if the next live discovery
succeeds, but it is not a durable fix and was not performed on the user's server.
Provider qualification bypasses catalog membership but is not a reliable Astra
workaround until the OpenAI remapping problem is fixed. [pinning][routing]
[remapping][openai-provider]

## Verification and remaining gaps

- Pulled tracked origin with `git pull --ff-only`; it was current at `d77ccb2`.
- Fetched upstream, found it one commit ahead, and fast-forwarded using
  `git pull --ff-only upstream master` to `e8505a7`.
- Existing `go test ./internal/lib/modelrouting ./internal/providerdispatch
  ./internal/providers/openai` passed. This is baseline evidence, not proof of a fix.
- Existing routing tests cover initial cache miss, hit, fetch error, selection and
  ordering. OpenAI catalog tests cover parsing/filtering but no cache expiry or
  fallback recovery. [routing tests][routing-tests] [OpenAI tests][openai-tests]
- Strict OpenSpec validation reports 15 passed, 0 failed, including this change.
- No production logs or account-scoped live catalog were inspected. No model
  entitlement or runtime-specific causal claim is established.
- Regression additions, implementation, full verification, and archive await the
  human-approved OpenSpec change required by `AGENTS.md` and `CLAUDE.md`.

## Research record

Discovery searched the exact error, model cache constructors/readers/writers,
refresh/invalidation calls, provider GetModels implementations, lifecycle mutation,
remapping, current specs, historical commits, and existing regression tests.
Follow-up compared OpenAI, Copilot, compatible endpoints, and Alibaba; traced
public/admin model listing against generation; and checked response caching as an
alternative explanation. All evidence is first-party OmniLLM source at the pinned
revision, read on 2026-09-05. Historical ownership was inspected with `git log` and
`git show`; it does not change the runtime findings.

Research stopped when the failure mechanism and proposed remedy were supported by
direct source evidence and remaining uncertainty required incident data or the
approved regression implementation. External model-marketing documentation would
not establish account-specific availability or repair this local cache defect.

| Claim / gap | Confidence | Contradiction or missing evidence | Next verification |
| --- | --- | --- | --- |
| Process-lifetime routing cache | High, direct implementation | None in examined code | Clock/lifecycle regression |
| OpenAI fallback omits Astra and is cached as success | High, direct implementation | Incident's provider is unconfirmed | Mock 503 followed by Astra catalog |
| Refresh does not repair routing | High, independent call-path inspection | No integrated regression yet | Admin refresh then Responses request |
| Exact Astra can silently remap on degraded discovery | High, direct implementation | No captured user response showing remap | Assert upstream request model |
| This caused the reported production incident | Unconfirmed | Logs, provider, timing unavailable | Correlate request ID and discovery state |

## Source ledger

All sources below are authored/maintained by the OmniLLM project, pinned to
`e8505a78dec917a38e3f68793713eff4347e1f30`, and accessed locally on 2026-09-05.
Links provide immutable source provenance; relevant code titles and locations
are described next to each claim. Individual source publication dates are not
asserted; the examination revision is the reproducibility boundary.

[routing]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/lib/modelrouting/modelrouting.go
[openai-models]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/providers/openai/models.go
[openai-provider]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/providers/openai/provider.go
[attempts]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/providerdispatch/attempts.go
[responses]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/routes/responses.go
[admin-loader]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/routes/admin_provider_config.go
[model-list]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/routes/models.go
[registry]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/registry/registry.go
[copilot]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/providers/copilot/models.go
[compatible]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/providers/openaicompatprovider/provider.go
[prepare]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/providerdispatch/prepare.go
[db-cache]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/database/store_cache.go
[resolution]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/routes/model_resolution.go
[routing-tests]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/lib/modelrouting/modelrouting_test.go
[openai-tests]: https://github.com/OmniLLM/omnillm/blob/e8505a78dec917a38e3f68793713eff4347e1f30/internal/providers/openai/models_test.go
