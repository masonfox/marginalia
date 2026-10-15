## MODIFIED Requirements

### Requirement: Choosing a scope when starting a conversation
Starting a conversation SHALL require the reader to choose how far they have read in each of its books: one of the book's reading units, or "whole book". No choice SHALL be preselected. Choosing a unit SHALL set that book's position bound to the unit's end position and record the unit's label as the scope's label. Choosing "whole book" SHALL leave the bound unset. The system SHALL reject a scope that does not match one of the book's current reading units. When the conversation is started from a passage reference, the choices SHALL be limited to "whole book" and the units whose end position is at or after the passage's reveal position. The dialog SHALL say which unit contains the passage.

#### Scenario: Choose a chapter
- **WHEN** a reader starts a conversation about a book and chooses "Chapter 22"
- **THEN** the conversation is created with a bound at the end of Chapter 22, and no retrieval tool returns a passage of that book revealed after it

#### Scenario: Choose whole book
- **WHEN** a reader starts a conversation and chooses "whole book"
- **THEN** the conversation is created with no bound for that book

#### Scenario: No choice made
- **WHEN** a reader opens the new-conversation dialog
- **THEN** the conversation cannot be started until a scope is chosen

#### Scenario: Stale choice
- **WHEN** a book is reparsed while the reader has the dialog open, and the reader then submits a unit whose end position no longer matches a current unit
- **THEN** no conversation is created, and the reader is asked to choose again from the current units

#### Scenario: Starting from a passage
- **WHEN** a reader starts a conversation from a passage in Chapter 9
- **THEN** the dialog says the passage is in Chapter 9, offers only Chapter 9, later units, and "whole book", and preselects nothing
