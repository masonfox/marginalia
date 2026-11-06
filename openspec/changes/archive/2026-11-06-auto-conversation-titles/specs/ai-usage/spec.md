## ADDED Requirements

### Requirement: Conversation naming usage
The system SHALL record a distinct conversation-title usage purpose for each automatic naming provider attempt, associated with its conversation and actual provider/model but no assistant message or edition. It SHALL retain reported input, output, cache and reasoning token counts, steps and completeness using the same unknown-count and estimated-cost conventions as reply usage. Reported usage SHALL be counted even when a generated title is invalid, superseded by a manual rename, or the attempt fails. Incomplete or interrupted calls SHALL be marked incomplete; unreported tokens SHALL remain unknown. Durable recovery SHALL NOT duplicate recorded naming usage or issue a replacement provider call to obtain missing usage.

#### Scenario: Title superseded
- **WHEN** a naming call reports usage but its title loses to a manual rename
- **THEN** its reported usage is recorded once under the conversation-title purpose

#### Scenario: Interrupted naming
- **WHEN** a naming attempt fails or times out after reporting some usage
- **THEN** the reported usage is retained as incomplete and unreported counts remain unknown

### Requirement: Naming included in conversation totals
Conversation totals SHALL include naming usage and reply usage, including failed reply attempts, with existing pricing and unknown-price rules. Naming usage SHALL NOT appear as an assistant reply or alter per-reply figures or the count of replies missing usage. The conversation SHALL identify naming's contribution separately from replies and disclose incomplete or unknown naming usage. Naming usage SHALL be deleted with its conversation, and deletion racing with recording SHALL NOT recreate the conversation or interrupt chat.

#### Scenario: Combined total
- **WHEN** a conversation has recorded naming and reply calls
- **THEN** its total includes both exactly once, names the naming contribution separately, and leaves each reply's usage unchanged

#### Scenario: Unknown naming cost
- **WHEN** naming uses a model with no known price or has unknown usage
- **THEN** its available token counts remain visible and the total exposes the applicable unknown cost or incomplete accounting

#### Scenario: Deleted during accounting
- **WHEN** a conversation is deleted before its naming usage can be saved
- **THEN** no usage row or conversation is recreated and the missing parent is handled without surfacing a chat error
