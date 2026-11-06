## ADDED Requirements

### Requirement: Opening prompt conversation title
The system SHALL attempt automatic naming once when a newly created conversation receives its first persisted user message, using the model selected for that turn, including the chat default when no conversation override exists. It SHALL derive a concise, recognizable title from only the opening user prompt, aiming for roughly three to seven words describing the question subject without answering it, adding interpretations, or introducing spoilers. It SHALL NOT send later messages, assistant replies, book contents, or attached passage contents for naming. Titles SHALL be rendered as plain text. Existing conversations at deployment SHALL NOT be backfilled, including existing empty conversations.

#### Scenario: Opening question
- **WHEN** a new conversation receives its opening question with a selected model
- **THEN** naming uses that model and the opening prompt to summarize the question subject, without using the answer

#### Scenario: Later turns and model changes
- **WHEN** the reader continues, retries a reply, changes models, or reopens a conversation
- **THEN** no new naming attempt is made and its generated title does not evolve

#### Scenario: Existing conversation
- **WHEN** a conversation created before deployment is opened or receives a message
- **THEN** no automatic naming is started

### Requirement: Independent bounded naming lifecycle
The system SHALL immediately retain the existing provisional naming behavior while naming runs independently of the reply. Naming SHALL have bounded concurrency, input size, output size, execution time and pending lifetime. Eligibility and the consumption of the single naming attempt SHALL be durable. Pending work SHALL survive restart, but a provider attempt interrupted after starting SHALL NOT be repeated. Failure, invalid output, timeout or expired pending work SHALL preserve the provisional title without interrupting chat or asking the reader to retry naming. Stopping a reply or leaving its page SHALL NOT cancel naming. Deleting a conversation SHALL prevent late title writes and SHALL cancel or discard its pending work.

#### Scenario: Naming finishes after reply
- **WHEN** the reply finishes before naming
- **THEN** the reply remains usable and naming can still update the title independently

#### Scenario: Naming failure
- **WHEN** naming fails or returns an unusable title
- **THEN** the provisional title remains, chat continues normally and later turns do not retry naming

#### Scenario: Restart boundaries
- **WHEN** the server restarts with queued naming and a different naming attempt already started
- **THEN** queued work remains eligible within its pending lifetime and the started attempt is not invoked again

#### Scenario: Stop or delete
- **WHEN** the reader stops a reply then deletes its conversation while naming runs
- **THEN** stopping alone does not cancel naming, but deletion prevents any late result from recreating or updating the conversation

### Requirement: Manual title precedence and completion visibility
A manual rename SHALL always take precedence over automatic naming, including when the operations race or the reader chooses a name equal to the provisional or default title. After naming completes, the open conversation header and mounted conversation lists SHALL refresh to the persisted title without requiring another message, reload or reply completion. Refresh SHALL preserve an in-progress reply, typed draft, manual rename and loaded list pages, and SHALL cease tracking terminal or deleted work.

#### Scenario: Racing manual rename
- **WHEN** a reader renames a conversation while a generated result is being saved
- **THEN** the final persisted and displayed title is the reader's name regardless of operation ordering

#### Scenario: Late completion in lists
- **WHEN** naming finishes after the reply and the conversation appears in a mounted list
- **THEN** its row and any open header show the persisted title without discarding loaded rows or changing message activity order
