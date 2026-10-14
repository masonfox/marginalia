## ADDED Requirements

### Requirement: Conversation usage display
The conversation view SHALL show, for each assistant reply that has recorded usage, its token counts (input, cached input, output) and estimated cost in a compact, secondary form that does not interrupt reading. It SHALL also show the conversation's running total of tokens and estimated cost, including attempts that failed and were retried. Totals SHALL update when a reply finishes, without a page reload. Usage figures SHALL be visible to any signed-in reader who can open the conversation and SHALL never include credentials.

#### Scenario: Reply finishes
- **WHEN** a reply finishes streaming
- **THEN** its token counts and estimated cost appear with it, and the conversation total includes them

#### Scenario: Stopped reply
- **WHEN** the reader stops a reply partway
- **THEN** the usage shown for it is marked as possibly incomplete

#### Scenario: Reopened conversation
- **WHEN** the reader reopens a conversation later
- **THEN** each reply's usage and the conversation total are shown as they were recorded

### Requirement: Stable request prefix
Within a conversation, the system prompt and the tool definitions sent to the model SHALL be identical, byte for byte, on every step of the tool loop and on every turn, unless the conversation's books or the prompt version change. They SHALL NOT contain timestamps, random values, or other content that varies between requests, and the tool list SHALL be sent in a fixed order. Earlier messages SHALL be replayed to the model unchanged from turn to turn.

#### Scenario: Two turns, same prefix
- **WHEN** the reader sends two messages in the same conversation
- **THEN** the system prompt and tool definitions sent for both are identical

#### Scenario: Stored history replay
- **WHEN** a conversation is resumed after a restart
- **THEN** the earlier messages sent to the model are the same as when they were last sent before the restart
