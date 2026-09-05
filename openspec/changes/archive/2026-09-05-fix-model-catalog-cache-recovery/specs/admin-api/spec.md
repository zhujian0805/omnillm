## ADDED Requirements

### Requirement: Model refresh updates generation availability
A successful authenticated provider model refresh SHALL bypass persisted and
provider-local catalog caches and replace or invalidate the corresponding
generation routing snapshot before returning. Failed or degraded refresh MUST NOT
overwrite last successful catalog data with fallback data or claim fresh discovery.

#### Scenario: Refresh discovers Astra
- **WHEN** routing holds an old catalog without Astra and an authenticated refresh successfully discovers it
- **THEN** a subsequent generation request can resolve Astra without restarting OmniLLM

#### Scenario: Refresh removes model
- **WHEN** a successful authoritative refresh omits a model from the previous catalog
- **THEN** ordinary generation resolution no longer uses that obsolete snapshot to select the provider

#### Scenario: Refresh fails
- **WHEN** a forced refresh receives a transient discovery failure and has fallback display data
- **THEN** fallback display handling does not overwrite successful catalog data or advance its freshness

#### Scenario: Concurrent stale fetch
- **WHEN** a pre-refresh fetch completes after successful admin refresh
- **THEN** it cannot replace the refreshed generation snapshot with its older catalog
