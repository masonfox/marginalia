## Purpose

Records the tokens every AI call consumes and turns them into labeled cost estimates, so operators can see what conversations (and later, background AI work) cost and compare models and changes.

## Requirements

### Requirement: Usage recorded per AI call
The system SHALL record token usage for every AI call it makes on behalf of a conversation turn: input tokens, output tokens, cache-read tokens, cache-write tokens, and reasoning tokens, each when the provider reports it, plus the number of model steps the call took. When a call takes several steps (a tool loop), the recorded usage SHALL be the sum over all completed steps. A count the provider does not report SHALL be stored as unknown, not as zero. Usage SHALL be stored with the model name that produced it.

#### Scenario: Tool loop summed
- **WHEN** the assistant answers a message using four model steps
- **THEN** the stored usage for that reply is the sum of the four steps' input, output, cache-read, cache-write, and reasoning tokens, and records four steps

#### Scenario: Provider without cache details
- **WHEN** the configured provider reports input and output tokens but no cache figures
- **THEN** input and output are stored and the cache figures are stored as unknown

### Requirement: Usage kept for interrupted and failed replies
The system SHALL store usage for a reply that was stopped by the reader or ended in a provider error, covering every step that completed before it ended. A step that was cut off before the provider reported its usage SHALL NOT be counted, and the stored usage SHALL be marked as possibly incomplete.

#### Scenario: Reader stops a reply
- **WHEN** the reader stops a generation after two completed steps
- **THEN** the saved reply carries the usage of those two steps and is marked as possibly incomplete

#### Scenario: Retry after an error
- **WHEN** a reply fails and the reader retries it
- **THEN** the failed attempt's usage is still counted in the conversation total, even though the failed reply is replaced

### Requirement: Cost estimates
The system SHALL estimate the cost of recorded usage from a per-model price table giving input, output, cache-read, and cache-write prices per million tokens. Operators SHALL be able to add or override prices for any model through configuration. Reasoning tokens SHALL be priced as output. Every cost shown SHALL be labeled as an estimate. When the model has no known price, the system SHALL show token counts and SHALL NOT show a cost.

#### Scenario: Known model
- **WHEN** a reply produced by a model with a known price is shown
- **THEN** an estimated cost is shown alongside its token counts, labeled as an estimate

#### Scenario: Unknown model
- **WHEN** usage was produced by a model with no price in the table or in configuration
- **THEN** token counts are shown and the cost is shown as unknown

#### Scenario: Operator override
- **WHEN** the operator configures a price for a model
- **THEN** estimates for that model use the configured price instead of the built-in one

### Requirement: Messages without usage
Messages created before usage recording, and replies whose provider reported no usage, SHALL show usage as unknown. They SHALL be excluded from totals, and a total that excludes any such reply SHALL say so.

#### Scenario: Old conversation
- **WHEN** a reader opens a conversation whose replies were saved before this change
- **THEN** those replies show no usage, and the conversation total states that some replies have no recorded usage

### Requirement: Preprocessing usage recorded per edition
The system SHALL record token usage for every preprocessing model call, with the preprocessing model's name, the edition it was for, and the same token fields as conversation usage. Usage SHALL be recorded for failed attempts that reached the provider and reported usage. Preprocessing usage SHALL be priced from the same price table and labeled as an estimate, and totals SHALL be available per edition. Usage SHALL be kept when derived rows are replaced, and deleted with the edition.

#### Scenario: Unit processed
- **WHEN** a unit is preprocessed
- **THEN** its usage is recorded against the edition with the preprocessing model

#### Scenario: Edition total
- **WHEN** preprocessing ran twice for an edition
- **THEN** the edition's preprocessing total includes both runs, with an estimated cost when the model has a known price

#### Scenario: Unknown model
- **WHEN** the preprocessing model has no known price
- **THEN** token counts are shown and cost is unknown
