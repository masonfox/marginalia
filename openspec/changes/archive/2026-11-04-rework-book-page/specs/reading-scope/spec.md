## MODIFIED Requirements

### Requirement: Choosing a scope when starting a conversation
Starting a conversation SHALL require a chosen scope for each of its books: one of the book's reading units, or "whole book". A conversation SHALL be startable from the book page composer (see "Scope in the book page composer") or from the new-conversation dialog, which is used when starting from a passage. When the book has a reading position whose choice is offered, that choice SHALL be preselected (see "Reading position suggested when choosing a scope"). Otherwise nothing SHALL be preselected, and the conversation SHALL NOT be startable until the reader chooses. Choosing a unit SHALL set that book's position bound to the unit's end position and record the unit's label as the scope's label. Choosing "whole book" SHALL leave the bound unset. The system SHALL reject a scope that does not match one of the book's current reading units. When the conversation is started from a passage reference, the choices SHALL be limited to "whole book" and the units whose end position is at or after the passage's reveal position. The dialog SHALL say which unit contains the passage.

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
- **WHEN** a book is reparsed while the reader has the scope choices open, and the reader then submits a unit whose end position no longer matches a current unit
- **THEN** no conversation is created, and the reader is asked to choose again from the current units

#### Scenario: Starting from a passage
- **WHEN** a reader with no reading position starts a conversation from a passage in Chapter 9
- **THEN** the dialog says the passage is in Chapter 9, offers only Chapter 9, later units, and "whole book", and preselects nothing

### Requirement: Partway choices listed before whole book
Every control that asks the reader to choose a reading unit or the whole book SHALL list the reading-unit choices first and the whole-book choice last. This applies to starting a conversation from the dialog or the book page composer, widening a scope, setting the reading position, choosing the Guide's bound, and choosing a note's "as of" point.

#### Scenario: New-conversation order
- **WHEN** a reader opens the new-conversation dialog
- **THEN** the partway choice appears above "whole book"

#### Scenario: Other pickers follow the same order
- **WHEN** a reader opens the reading-position control, the widen-scope control, or the composer's scope control
- **THEN** the partway choice appears above "whole book"

## ADDED Requirements

### Requirement: Scope in the book page composer
The book page composer SHALL always show the scope the next conversation will use, above the message input:
- When the reading position is a unit, the scope SHALL be that unit, shown as "Through <unit label>", with a note that the assistant reads only that far but may know the book from its training.
- When the position is finished, the scope SHALL be the whole book, shown with the notice that the assistant may reveal any part of the book.
- When the position is unset, the composer SHALL ask how far the reader has read instead of showing a scope.

The composer SHALL offer a control to change the scope before sending. It SHALL open the book's reading-unit choices with the reading position marked, and SHALL ask whether to save the choice as the reading position, which SHALL be the default, or to use it only for this conversation. It SHALL state that the reading position is shared by everyone using the instance. Saving SHALL follow the reading-position rules, including confirmation before moving the position back, and the composer SHALL then show the new position as the scope. Choosing "only for this conversation" SHALL leave the reading position unchanged, SHALL need no move-back confirmation, and the composer SHALL show the scope as applying to this conversation only, with a control to go back to the reading position. That choice SHALL apply only to the next conversation started from the composer and SHALL be discarded when the reader leaves the page.

When the position is unset and the reader sends, the scope choices SHALL open before anything is created, with nothing preselected and saving as the reading position selected. Choosing a scope SHALL create the conversation and send the message. Dismissing the choices SHALL create nothing. Changing the scope, dismissing the choices, or a rejected stale choice SHALL keep the typed message in the composer.

#### Scenario: Default scope from the position
- **WHEN** the reading position is Chapter 12 and the reader sends a question from the composer without changing anything
- **THEN** the conversation is created through Chapter 12

#### Scenario: Update the position before asking
- **WHEN** the position is Chapter 12, the reader chooses Chapter 15 in the composer's scope control with saving selected, and then sends
- **THEN** the reading position becomes Chapter 15 and the conversation is created through Chapter 15

#### Scenario: Earlier scope for one conversation
- **WHEN** the position is Chapter 15 and the reader chooses Chapter 3 for this conversation only and sends
- **THEN** no move-back confirmation is asked, the conversation is created through Chapter 3, and the position stays at Chapter 15

#### Scenario: Moving the position back from the composer
- **WHEN** the position is Chapter 15 and the reader chooses Chapter 3 with saving selected
- **THEN** the reader is asked to confirm moving the position back, and the position and the composer's scope stay at Chapter 15 unless they confirm

#### Scenario: First question with no position
- **WHEN** a book has no reading position and the reader types a question and sends
- **THEN** the scope choices open with nothing selected, and after the reader chooses Chapter 4 the position becomes Chapter 4 and the conversation is created through Chapter 4 with the question sent

#### Scenario: Dismiss the first-question choices
- **WHEN** the scope choices open on sending with no position and the reader dismisses them
- **THEN** no conversation is created and the question is still in the composer

#### Scenario: Finished book
- **WHEN** the position is finished
- **THEN** the composer shows the whole-book scope with the notice that the assistant may reveal any part of the book
