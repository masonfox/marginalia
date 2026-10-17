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
Setting the position to a later unit, or to finished, SHALL take effect immediately. Setting it to an earlier unit SHALL require the reader to confirm a move back, for example for a re-read. The reader SHALL be able to clear the position back to unset. The position SHALL NOT change automatically when passages are opened, searched, or cited.

#### Scenario: Move forward
- **WHEN** the position is Chapter 12 and the reader sets Chapter 15
- **THEN** the position becomes Chapter 15 with no confirmation

#### Scenario: Move back needs confirmation
- **WHEN** the position is Chapter 15 and the reader chooses Chapter 3
- **THEN** the system asks for confirmation, and the position stays at Chapter 15 unless the reader confirms

#### Scenario: Reading a later passage does not advance
- **WHEN** the reader opens a passage in Chapter 30 from a search while their position is Chapter 12
- **THEN** the position stays at Chapter 12

### Requirement: Position is a default, never a conversation's authority
The reading position SHALL be used only as the default bound for browsing the guide, as the default "as of" anchor for reader notes, and as a suggestion when choosing a conversation's scope. It SHALL NOT change the bound of any existing conversation, and changing the position SHALL NOT change any conversation.

#### Scenario: Conversation unaffected
- **WHEN** a conversation is scoped through Chapter 10 and the reader moves their position to Chapter 20
- **THEN** the conversation remains scoped through Chapter 10

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
