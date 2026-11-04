## MODIFIED Requirements

### Requirement: Choosing a scope when starting a conversation
Starting a conversation SHALL require a chosen scope for each of its books: one of the book's reading units, or "whole book". When the book has a reading position whose choice is offered, that choice SHALL be preselected (see "Reading position suggested when choosing a scope"). Otherwise nothing SHALL be preselected, and the conversation SHALL NOT be startable until the reader chooses. Choosing a unit SHALL set that book's position bound to the unit's end position and record the unit's label as the scope's label. Choosing "whole book" SHALL leave the bound unset. The system SHALL reject a scope that does not match one of the book's current reading units. When the conversation is started from a passage reference, the choices SHALL be limited to "whole book" and the units whose end position is at or after the passage's reveal position. The dialog SHALL say which unit contains the passage.

#### Scenario: Choose a chapter
- **WHEN** a reader starts a conversation about a book and chooses "Chapter 22"
- **THEN** the conversation is created with a bound at the end of Chapter 22, and no retrieval tool returns a passage of that book revealed after it

#### Scenario: Choose whole book
- **WHEN** a reader starts a conversation and chooses "whole book"
- **THEN** the conversation is created with no bound for that book

#### Scenario: No choice made
- **WHEN** a reader opens the new-conversation dialog for a book with no reading position
- **THEN** nothing is selected and the conversation cannot be started until a scope is chosen

#### Scenario: Stale choice
- **WHEN** a book is reparsed while the reader has the dialog open, and the reader then submits a unit whose end position no longer matches a current unit
- **THEN** no conversation is created, and the reader is asked to choose again from the current units

#### Scenario: Starting from a passage
- **WHEN** a reader with no reading position starts a conversation from a passage in Chapter 9
- **THEN** the dialog says the passage is in Chapter 9, offers only Chapter 9, later units, and "whole book", and preselects nothing

### Requirement: Widening a conversation's scope
The reader SHALL be able to widen a book's scope in an existing conversation to a later reading unit or to "whole book". The system SHALL NOT offer narrowing and SHALL reject a request that would narrow the scope, because earlier replies may already contain later material. When the book's reading position is later than the conversation's current scope for that book, the widen choices SHALL preselect the position: its unit, or "whole book" when the position is finished. Otherwise nothing SHALL be preselected. A generation already running when the scope is widened SHALL finish under the bound it started with. Later messages SHALL use the widened bound.

#### Scenario: Widen to a later chapter
- **WHEN** a conversation is scoped through Chapter 22 and the reader widens it to Chapter 30
- **THEN** the bound moves to the end of Chapter 30 and the next reply can retrieve passages from Chapters 23 to 30

#### Scenario: Only later units offered
- **WHEN** a reader opens the scope control of a conversation scoped through Chapter 22
- **THEN** the choices are the units after Chapter 22 and "whole book"

#### Scenario: Position later than scope is preselected
- **WHEN** the reading position is Chapter 30 and the reader opens the scope control of a conversation scoped through Chapter 22
- **THEN** Chapter 30 is selected and the reader can widen without choosing again

#### Scenario: Finished position preselects whole book
- **WHEN** the reading position is finished and the reader opens the scope control of a conversation scoped through Chapter 22
- **THEN** "whole book" is selected

#### Scenario: Position not later than scope
- **WHEN** the reading position is Chapter 10, or unset, and the reader opens the scope control of a conversation scoped through Chapter 22
- **THEN** nothing is selected and the reader must choose before widening

#### Scenario: Narrowing rejected
- **WHEN** a request asks to change a conversation scoped through Chapter 22 to Chapter 10, or a whole-book conversation to any unit
- **THEN** the request is rejected and the scope is unchanged

### Requirement: Reading position suggested when choosing a scope
When a book has a reading position, the scope choices for a new conversation SHALL mark the choice that matches it (a unit, or whole book when the position is finished) as the reader's position, and SHALL preselect that choice, so the conversation can be started without choosing again. The reader SHALL be able to change the selection before starting. The chosen scope SHALL be stated in the dialog before the conversation is started. When the conversation is started from a passage, the position's choice SHALL be marked and preselected only when it is among the offered choices. Otherwise nothing SHALL be marked or preselected.

#### Scenario: Position highlighted
- **WHEN** a book's reading position is Chapter 12 and the reader opens the new-conversation dialog
- **THEN** Chapter 12 is marked as their position and selected, the dialog states the scope as through Chapter 12, and the conversation can be started right away

#### Scenario: Finished position preselects whole book
- **WHEN** a book's reading position is finished and the reader opens the new-conversation dialog
- **THEN** "whole book" is marked and selected, and the spoiler notice is shown

#### Scenario: Reader changes the preselected choice
- **WHEN** Chapter 12 is preselected and the reader chooses Chapter 8 instead
- **THEN** the conversation is created through Chapter 8 and the reading position is unchanged

#### Scenario: Position at or after the starting passage
- **WHEN** the position is Chapter 12 and the reader starts a conversation from a passage in Chapter 9
- **THEN** Chapter 12 is marked and selected

#### Scenario: Position before the starting passage
- **WHEN** the position is Chapter 5 and the reader starts a conversation from a passage in Chapter 9
- **THEN** no choice is marked or selected

## ADDED Requirements

### Requirement: Partway choices listed before whole book
Every control that asks the reader to choose a reading unit or the whole book SHALL list the reading-unit choices first and the whole-book choice last. This applies to starting a conversation, widening a scope, setting the reading position, choosing the Guide's bound, and choosing a note's "as of" point.

#### Scenario: New-conversation order
- **WHEN** a reader opens the new-conversation dialog
- **THEN** the partway choice appears above "whole book"

#### Scenario: Other pickers follow the same order
- **WHEN** a reader opens the reading-position control or the widen-scope control
- **THEN** the partway choice appears above "whole book"
