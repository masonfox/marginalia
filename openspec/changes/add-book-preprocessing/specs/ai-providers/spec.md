## ADDED Requirements

### Requirement: Optional preprocessing model
The system SHALL accept an optional `AI_PREPROCESS_MODEL` naming a model of the same provider as `AI_MODEL`, used for preprocessing instead of it. When unset, preprocessing SHALL use `AI_MODEL`. It SHALL use the provider's key and base URL. A value set without a configured provider SHALL fail startup validation naming the variable, and secrets SHALL never appear in errors. Preprocessing requests SHALL honor the configured prompt caching and effort settings where they apply, and the provider status SHALL show the preprocessing model.

#### Scenario: Small model for bulk work
- **WHEN** `AI_MODEL` is a mid-tier model and `AI_PREPROCESS_MODEL` is a small model
- **THEN** conversations use the first and preprocessing uses the second

#### Scenario: Default
- **WHEN** `AI_PREPROCESS_MODEL` is unset
- **THEN** preprocessing uses `AI_MODEL`

#### Scenario: Set without provider
- **WHEN** `AI_PREPROCESS_MODEL` is set and no provider is configured
- **THEN** the application exits at startup with an error naming the variable
