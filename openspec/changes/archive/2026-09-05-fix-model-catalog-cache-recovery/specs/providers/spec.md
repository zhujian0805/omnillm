## MODIFIED Requirements

### Requirement: Cached model discovery
The persisted model-list view SHALL use a per-instance and provider-type cache
with a 24-hour default TTL. Forced refresh SHALL bypass this view and any
provider-local catalog cache. Generation routing SHALL follow its separate bounded
freshness contract. Degraded discovery MUST NOT overwrite successful catalog data
or advance its successful-fetch timestamp.

#### Scenario: Provider type changes
- **WHEN** an instance identifier is reused for a different provider type
- **THEN** the old provider-type cache is not used

#### Scenario: Forced provider-local refresh
- **WHEN** an operator refreshes OpenAI models while its local successful cache is fresh
- **THEN** discovery attempts a live catalog fetch rather than returning the memoized catalog

#### Scenario: Fallback during discovery
- **WHEN** discovery returns a built-in or unavailable-endpoint fallback
- **THEN** callers can identify it as degraded and do not save it as new successful discovery

## ADDED Requirements

### Requirement: Bounded OpenAI last-good catalog recovery
OpenAI OAuth SHALL reuse its last successful catalog for at most one hour from
the original successful fetch during transient network, HTTP 429, or HTTP 5xx
discovery failures. Stale reuse SHALL NOT reset successful-fetch time. Authentication
failure or account/configuration invalidation MUST prevent reuse of obsolete
authorization-scoped data. Built-in fallback SHALL remain explicitly degraded.

#### Scenario: Expired catalog and temporary outage
- **WHEN** a 15-minute-old OpenAI catalog contains Astra and refresh returns HTTP 503
- **THEN** Astra remains discoverable from the bounded last-good snapshot and a later request retries after backoff

#### Scenario: Maximum stale age exceeded
- **WHEN** no successful OpenAI catalog fetch has occurred for more than one hour
- **THEN** the expired snapshot is no longer offered as last-good availability

#### Scenario: Different account
- **WHEN** OpenAI re-authentication changes the account behind an instance
- **THEN** discovery cannot reuse the previous account's catalog

### Requirement: Exact OpenAI model preservation during catalog degradation
The OpenAI adapter SHALL preserve explicitly routed model identifiers when absent
from a degraded catalog. Compatibility remapping SHALL be limited to explicit
legacy mappings and MUST NOT substitute a catalog default for arbitrary unknown
GPT-family model identifiers.

#### Scenario: New model absent from fallback
- **WHEN** a selected or pinned OpenAI request names `gpt-6-astra` and discovery degrades to an older built-in list
- **THEN** upstream generation receives `gpt-6-astra` unchanged

#### Scenario: Unsupported explicit model
- **WHEN** a pinned request uses an unknown identifier without an explicit compatibility mapping
- **THEN** the identifier reaches upstream unchanged and an upstream rejection remains visible

#### Scenario: Explicit legacy mapping
- **WHEN** a model matches an explicitly retained legacy compatibility mapping
- **THEN** the adapter applies that mapping consistently regardless of catalog ordering
