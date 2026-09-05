## ADDED Requirements

### Requirement: Bounded generation catalog freshness
Generation routing SHALL reuse ordinary provider catalog snapshots for at most
five minutes and SHALL delegate OpenAI OAuth catalog freshness to its 15-minute
provider-owned cache without adding an outer cache lifetime. Degraded, nil, or
empty discovery SHALL NOT be stored as a successful routing catalog. Concurrent
fetches for one provider lifecycle SHALL coalesce, and unsuccessful discovery
SHALL be retried on later requests after a 30-second backoff.

#### Scenario: Catalog gains a model
- **WHEN** a successful provider catalog changes and the applicable freshness interval expires
- **THEN** a subsequent successful discovery makes the new model routable without restart

#### Scenario: Initial discovery returns fallback
- **WHEN** initial discovery degrades and upstream recovers with the requested model
- **THEN** the first request after failure backoff can discover and route that model without restart

#### Scenario: Concurrent discovery failure
- **WHEN** concurrent requests require the same provider catalog during an outage
- **THEN** they share one fetch and further fetches wait until the retry interval expires

#### Scenario: Independent provider
- **WHEN** one provider catalog fetch is blocked
- **THEN** an unrelated provider's fresh catalog remains accessible without waiting for that fetch

### Requirement: Catalog lifecycle isolation
Cached generation catalogs SHALL be isolated by provider instance, type, and
current lifecycle generation. Replacement, relevant configuration or account
change, rename, and deletion SHALL invalidate obsolete ownership. A fetch begun
before invalidation MUST NOT publish into the new generation.

#### Scenario: Instance replacement
- **WHEN** a provider is replaced under the same instance ID with another type or configuration
- **THEN** subsequent routing does not reuse the previous provider's catalog

#### Scenario: Fetch races account change
- **WHEN** a catalog fetch completes after the provider is re-authenticated as another account
- **THEN** the old fetch cannot repopulate the new account's catalog cache

#### Scenario: Deleted identifier reused
- **WHEN** a provider is deleted or renamed and its old identifier is subsequently reused
- **THEN** the new owner cannot inherit the previous owner's routing catalog

### Requirement: Catalog recovery preserves routing policy
Catalog recovery SHALL preserve active-provider selection, ordinary model
enablement filtering, priority, affinity ordering, native model identifiers,
virtual-model behavior, explicit pinning, and failover alternatives.

#### Scenario: Disabled model reappears upstream
- **WHEN** refreshed discovery advertises a model disabled for ordinary routing
- **THEN** refresh does not make that provider an ordinary candidate for the disabled model

#### Scenario: Recovery across generation dialects
- **WHEN** equivalent Chat Completions, Messages, and Responses requests run after catalog recovery
- **THEN** all three resolve the same eligible model/provider set and preserve tool history
