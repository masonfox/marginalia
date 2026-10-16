# research-trail Specification

## Purpose

Defines how an assistant message presents the research the model performed (searches, passage reads, outline lookups) so a reader can see what an answer rests on without raw tool output getting in the way.

## Requirements

### Requirement: Grouped research trail
The system SHALL present the consecutive tool calls within an assistant message as a single research trail, not as separate top-level rows. While the message is still researching and has produced no reply text, the trail SHALL be expanded and show the step in progress. Once reply text begins, the trail SHALL collapse to a one-line summary that counts its searches and passages read, and the reader SHALL be able to expand it again. Tool calls separated by reply text SHALL form separate trails. A reader's own expand or collapse choice SHALL NOT be overridden by later updates to the message.

#### Scenario: Researching in progress
- **WHEN** the assistant is calling tools and has produced no reply text
- **THEN** the trail is expanded and shows the current step as in progress

#### Scenario: Collapse when the reply starts
- **WHEN** reply text begins streaming after tool calls
- **THEN** the trail collapses to a summary such as "Researched · 4 searches · 3 passages read"

#### Scenario: Reader expands a collapsed trail
- **WHEN** the reader expands a collapsed trail
- **THEN** it stays expanded while the reply continues to stream

#### Scenario: Reloaded conversation
- **WHEN** a reader reopens a conversation that contains earlier assistant messages with tool calls
- **THEN** each message shows its trail collapsed, built from the stored tool activity

### Requirement: Readable research steps
Each step in a trail SHALL be described in terms a reader understands and SHALL NOT expose internal identifiers as its primary label. A search step SHALL show its query and its result count, and a search with no results SHALL be shown as having found no matches. A passage-read step SHALL show the book section the passage belongs to. An outline step SHALL be described as browsing the table of contents. A step that did not complete SHALL show that it failed, with the failure reason. A step that the system refused or could not resolve (for example a passage that no longer exists) SHALL show that outcome instead of a normal result.

#### Scenario: Search with results
- **WHEN** a search for "Shrike Tree of Pain" returned 3 passages
- **THEN** the step reads as that query with "3 results"

#### Scenario: Search with no results
- **WHEN** a search returned no passages
- **THEN** the step is shown as finding no matches

#### Scenario: Passage read
- **WHEN** the model read a passage in "Part Three › Chapter 23"
- **THEN** the step is labeled with that section, not with the passage locator

#### Scenario: Failed step
- **WHEN** a tool call fails or returns a not-found or removed status
- **THEN** the step shows that outcome and any reason instead of a result

### Requirement: Passages in a trail link to the book
Expanding a search or read step SHALL list the passages it involved, each with a short snippet of its text, its book section, and, when the book has more than one, its book title. Each listed passage SHALL link to that passage in the reader. A snippet longer than a few lines SHALL be shortened with a control to show the rest, and the trail SHALL NOT contain nested scrolling regions for passage text.

#### Scenario: Follow a result to the passage
- **WHEN** the reader clicks a passage listed under a search step
- **THEN** the reader opens that passage in the book

#### Scenario: Long snippet
- **WHEN** a listed passage's text is longer than the preview length
- **THEN** it is shortened and the reader can reveal the remainder in place

#### Scenario: Superseded passage
- **WHEN** a listed passage's locator now points to a re-ingested version of the book
- **THEN** the link opens the current version of that passage when it can be resolved

### Requirement: Raw tool output is opt-in
The system SHALL NOT show raw tool input or output by default. Each step SHALL offer a control that reveals its raw data as formatted, copyable text. The system SHALL also offer a "Show tool details" preference that, when on, reveals the raw data for every step. The preference SHALL be remembered by the browser across reloads and SHALL NOT change what is stored for a conversation.

#### Scenario: Default view hides raw data
- **WHEN** a reader expands a trail without changing any preference
- **THEN** no raw tool input or output is displayed

#### Scenario: Reveal raw data for one step
- **WHEN** the reader uses a step's raw-data control
- **THEN** that step shows its raw data as formatted text with a way to copy it

#### Scenario: Tool details preference
- **WHEN** the reader turns on "Show tool details" and later reloads the page
- **THEN** raw data is shown for every step and the preference is still on

### Requirement: Research secondary to the reply
The trail SHALL be visually subordinate to the reply text, so that the reply remains the main content of an assistant message. Citations and the sources list in the reply SHALL be unaffected by the trail's state.

#### Scenario: Reply remains prominent
- **WHEN** a message has a collapsed trail and reply text
- **THEN** the trail occupies a single compact line above the reply and the reply starts without scrolling past tool rows

### Requirement: Guide context in the trail
When a reply was generated with a book map, its trail SHALL begin with a guide step per book, such as "Used chapter summaries through Chapter 12" or "Used chapter summaries for the whole book". The step SHALL be described from what the reply recorded: the book, its scope label, and a fingerprint of the map that was sent. The map text SHALL NOT be stored per message. Expanding the step SHALL list the summaries now within that scope, with corrections applied. When the current map no longer matches the recorded fingerprint, the step SHALL say that the guide has changed since this reply. The guide step SHALL NOT count as a search or a passage read in the trail's summary line. Replies created before this change SHALL show no guide step.

#### Scenario: Reply used the map
- **WHEN** a reply in a conversation scoped through Chapter 12 was generated with a book map
- **THEN** its trail starts with "Used chapter summaries through Chapter 12"

#### Scenario: Guide changed since
- **WHEN** the reader corrects a summary within scope after a reply was generated
- **THEN** that reply's guide step says the guide has changed since the reply

### Requirement: Readable guide lookups
An observation lookup step SHALL show the name looked up, the subject it resolved to when that differs, and the number of observations returned. Expanding it SHALL list each observation with its unit label and note, marking reader corrections. A notes lookup step SHALL be described as checking the reader's notes, with the number of notes returned. Expanding it SHALL list each note's title linked to the note.

#### Scenario: Observation lookup
- **WHEN** the model looked up "Strider" and received 4 observations under subject "Aragorn"
- **THEN** the step reads as looking up "Strider" (Aragorn) with 4 results

### Requirement: Correct from the trail
Each summary listed under a guide step, and each observation listed under an observation lookup step, SHALL offer a "Correct this" action that opens the correction flow for that item. A correction made this way SHALL affect later replies only. Earlier replies and their stored tool results SHALL be unchanged. The action SHALL NOT be offered for an item whose book was deleted, or for an item whose unit no longer has a current row.

#### Scenario: Correct an observation
- **WHEN** the reader chooses "Correct this" on an observation in a lookup step and replaces its text
- **THEN** the correction is saved, the next reply's lookups return the corrected text, and the earlier reply's stored result is unchanged

### Requirement: Save a reply excerpt as a note
When the reader selects text in an assistant reply, the selection actions SHALL include "Save as note". It SHALL open a new note for the conversation's book, prefilled with the excerpt as a quotation and a link back to the conversation. The note's "as of" anchor SHALL default to the conversation's scope for that book: the scope's unit, or the end of the book for whole-book scope. In a conversation with several books, the reader SHALL choose the book. The note SHALL NOT be created until the reader saves it.

#### Scenario: Save as note
- **WHEN** the reader selects a sentence in a reply of a conversation scoped through Chapter 12 and chooses "Save as note"
- **THEN** a draft note opens with the quoted sentence, a link to the conversation, and an anchor of Chapter 12
