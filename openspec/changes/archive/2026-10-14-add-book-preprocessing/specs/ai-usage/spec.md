## ADDED Requirements

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
