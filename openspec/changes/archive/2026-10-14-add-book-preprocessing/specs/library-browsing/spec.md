## ADDED Requirements

### Requirement: Preprocessing on book detail
When AI is configured, the book detail page SHALL show the edition's preprocessing status, progress while running, the model used, and its last error, together with the estimated spend (tokens and cost, labeled as an estimate). It SHALL offer an action to start preprocessing, or to regenerate it when stale or partly failed. The action SHALL warn that the whole book is sent to the provider. Status SHALL update without a manual reload while a job is active. When AI is not configured the page SHALL show no preprocessing status or action. Editions that are not ready SHALL NOT offer the action.

#### Scenario: Start from the page
- **WHEN** a reader starts preprocessing on a ready book
- **THEN** status shows queued, then running with progress, then complete

#### Scenario: Spend shown
- **WHEN** preprocessing has completed
- **THEN** the page shows its estimated cost and token counts

#### Scenario: Stale
- **WHEN** a book was reparsed after preprocessing
- **THEN** the page shows it as stale with an action to regenerate

#### Scenario: AI not configured
- **WHEN** no provider is configured
- **THEN** no preprocessing action or status is shown
