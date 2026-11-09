# reading-position Specification

## Purpose

Remembers how far the reader has read in each book, so browsing the guide and writing notes can default to a spoiler-safe bound without asking every time. Conversations keep their own scope.

## Requirements

### Requirement: Per-edition reading position
The system SHALL store at most one reading position per edition. The position SHALL be one of the edition's current reading units or "finished" (whole book). A unit position SHALL store that unit's end position and label. "Finished" SHALL store no bound. An edition with no stored position SHALL be treated as unset, and unset SHALL be a valid state. The position SHALL be shared by everyone who can sign in to the instance. The system SHALL reject a position that does not match one of the edition's current reading units.

#### Scenario: Set a position
- **WHEN** a reader sets their position in a book to "Chapter 12"
- **THEN** the edition's position is stored with Chapter 12's end position and the label "Chapter 12"

#### Scenario: Finished
- **WHEN** a reader marks a book finished
- **THEN** the edition's position is stored as whole book

#### Scenario: Never set
- **WHEN** a reader opens a book whose position was never set
- **THEN** its position is reported as unset

#### Scenario: Stale unit
- **WHEN** a reader submits a unit whose end position no longer matches a current unit after a reparse
- **THEN** the position is unchanged and the reader is asked to choose again

### Requirement: Forward-only with explicit move back
A reader setting the position to a later unit, or to finished, SHALL take effect immediately. A reader setting it to an earlier unit SHALL require the reader to confirm a move back, for example for a re-read. The reader SHALL be able to clear the position back to unset. The position SHALL NOT change automatically when passages are opened, searched, or cited. A position applied by progress sync SHALL take effect immediately in either direction, with no confirmation, because the provider is the authority for synced books.

#### Scenario: Move forward
- **WHEN** the position is Chapter 12 and the reader sets Chapter 15
- **THEN** the position becomes Chapter 15 with no confirmation

#### Scenario: Move back needs confirmation
- **WHEN** the position is Chapter 15 and the reader chooses Chapter 3
- **THEN** the system asks for confirmation, and the position stays at Chapter 15 unless the reader confirms

#### Scenario: Reading a later passage does not advance
- **WHEN** the reader opens a passage in Chapter 30 from a search while their position is Chapter 12
- **THEN** the position stays at Chapter 12

#### Scenario: Sync moves back without confirmation
- **WHEN** the position is Chapter 15 and a sync applies a reading that maps to Chapter 3
- **THEN** the position becomes Chapter 3 with no confirmation

### Requirement: Position is a default, never a conversation's authority
The reading position SHALL be used only as the default bound for browsing the guide, as the default "as of" anchor for reader notes, as the default scope of a conversation started from the book page composer, and as a suggestion when choosing a conversation's scope in the new-conversation dialog. The position SHALL be settable from the book page header and from the book page composer. It SHALL NOT change the bound of any existing conversation, and changing the position SHALL NOT change any conversation. Starting a conversation with a scope chosen for that conversation only SHALL NOT change the position.

#### Scenario: Conversation unaffected
- **WHEN** a conversation is scoped through Chapter 10 and the reader moves their position to Chapter 20
- **THEN** the conversation remains scoped through Chapter 10

#### Scenario: Default for the composer
- **WHEN** the position is Chapter 10 and the reader starts a conversation from the book page composer without changing its scope
- **THEN** the conversation is scoped through Chapter 10

#### Scenario: One-off scope leaves the position alone
- **WHEN** the position is Chapter 10 and the reader starts a conversation from the composer through Chapter 20 for this conversation only
- **THEN** the position stays at Chapter 10

### Requirement: Position survives reparsing
When an edition is reparsed, its position SHALL be moved in the same transaction that replaces the structure, following the same rule as conversation bounds: the new bound SHALL be the greatest new position whose passage text came from a passage at or before the old bound, and it SHALL never move later than the text it covered. The label SHALL be kept.

#### Scenario: Reparse shifts positions
- **WHEN** an edition with a position at the end of Chapter 12 is reparsed and earlier passages are inserted
- **THEN** the position still falls at the end of Chapter 12's text and still reads "Chapter 12"

### Requirement: Shared-position caveat
Wherever the reader sets the position, the interface SHALL state that the position is shared by everyone using this Marginalia instance.

#### Scenario: Caveat shown
- **WHEN** a reader opens the position control
- **THEN** it says the position is shared by everyone on this instance

### Requirement: Position deleted with the edition
Deleting an edition SHALL delete its reading position.

#### Scenario: Edition deleted
- **WHEN** an edition with a position is deleted
- **THEN** its position no longer exists

### Requirement: Position source
Each position SHALL record its source: set by hand, or applied by a named provider. A synced position SHALL also record the raw provider reading and the time it was applied. When the reader sets a synced book's position by hand, its source SHALL become manual until the next applied reading. The position control SHALL show a synced position's source, its raw reading, and how long ago it was applied, for example "synced from Hardcover · 42% · 2h ago". When the last sync moved the position earlier, the control SHALL say so and name the previous unit. This SHALL hold even when the sync cleared the position to unset.

#### Scenario: Synced position shown
- **WHEN** Hardcover's reading of 42% set the position to Chapter 11 two hours ago
- **THEN** the position control reads Chapter 11 and shows that it was synced from Hardcover at 42%, 2 hours ago

#### Scenario: Move back shown
- **WHEN** a sync moved the position from Chapter 14 back to Chapter 2
- **THEN** the position control says it moved back from Chapter 14

#### Scenario: Move back to unset shown
- **WHEN** a re-read reported at 3% moved the position from Chapter 14 back to unset
- **THEN** the position control shows no position, says it was synced from the provider at 3%, and says it moved back from Chapter 14

#### Scenario: Manual edit on a synced book
- **WHEN** the reader sets a synced book's position by hand
- **THEN** the control shows the position as set by hand until a sync applies a new reading
