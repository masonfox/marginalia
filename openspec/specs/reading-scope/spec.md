# reading-scope Specification

## Purpose

Lets a reader limit a conversation to the part of a book they have read, using reading units (chapters or their equivalent) derived from each edition's structure, and keeps that limit visible and correct over time.

## Requirements

### Requirement: Reading units derived from the table of contents
The system SHALL derive, for every ready edition, an ordered list of reading units. Each unit SHALL have a label, a start position, and an end position. Units SHALL be built from the table of contents as follows:
- Entries are taken in reading order of the passages they point to. Only the deepest entries are units, meaning entries with no child entry that points at a passage. Entries that point at no passage, or at a passage outside the linear reading order, are ignored.
- When several entries point at the same passage, only one unit starts there. Entries whose target comes before an earlier entry's target in reading order are ignored.
- A unit's end position SHALL be the position just before the next table-of-contents entry of any depth starts, so a part's title page belongs to the part that follows it. The last unit SHALL end at the last linear position of the edition.
- Leading and trailing runs of front and back matter (for example cover, title page, copyright, contents, dedication, acknowledgments, about the author, also by, notes, index) SHALL NOT be units. Their passages are covered by the neighboring unit.
- A unit's label SHALL be its entry's label, prefixed by the labels of its ancestor entries when it is nested. Labels that would still be identical SHALL be made distinct by a sequence number.

#### Scenario: Flat chapter list
- **WHEN** an edition's table of contents lists Cover, Copyright, Chapter 1 to Chapter 30, and Acknowledgments
- **THEN** its reading units are Chapter 1 to Chapter 30 in order, and Chapter 30 ends at the edition's last linear position

#### Scenario: Nested parts and chapters
- **WHEN** a table of contents nests chapters inside parts, and each part entry points at a part title page
- **THEN** the units are the chapters, each labeled with its part (for example "Part Two › 14"), and the last chapter of one part ends before the next part's title page

#### Scenario: Entry pointing into the middle of a section
- **WHEN** a table-of-contents entry points at a passage in the middle of a spine section
- **THEN** a unit starts at that passage, and the previous unit ends at the passage just before it

#### Scenario: Repeated labels
- **WHEN** several deepest entries share the same label and the same ancestors
- **THEN** each unit gets a distinct label, such as the shared label followed by a sequence number

#### Scenario: Units follow a reparse
- **WHEN** an edition is reparsed and its table of contents changes
- **THEN** its reading units reflect the new structure with no further action

### Requirement: Spine fallback for missing or sparse tables of contents
When the table of contents yields fewer than three reading units, the system SHALL instead derive one unit per linear spine section that contains linear passages, excluding leading and trailing front and back matter. Such a unit SHALL be labeled with its section title, or with "Section N" (N counting from 1 over the remaining units) when the section has no title.

#### Scenario: No table of contents
- **WHEN** an edition has no table-of-contents entries and twelve linear spine sections with text
- **THEN** it has twelve reading units, one per section

#### Scenario: Table of contents with only one useful entry
- **WHEN** an edition's table of contents lists only Cover, the book's title, and Copyright
- **THEN** its reading units come from its spine sections

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

### Requirement: Scope survives reparsing
When an edition is reparsed, every conversation bound on that edition SHALL be moved, in the same transaction that replaces the structure, so it covers the same text: the new bound SHALL be the greatest new position whose passage text came from a passage at or before the old bound. A bound SHALL never move later than the text it covered. The scope's label SHALL be kept.

#### Scenario: Reparse shifts positions
- **WHEN** a conversation is bounded at the end of Chapter 22 and a reparse inserts passages earlier in the book so that every later position increases
- **THEN** the bound still falls at the end of Chapter 22's text, and the conversation still shows "through Chapter 22"

#### Scenario: Last bounded passage removed
- **WHEN** the passage at the bound is removed by a reparse
- **THEN** the new bound is at the last surviving passage from before the old bound, and no passage from after the old bound becomes visible

### Requirement: Scope is visible
The conversation view SHALL show each book's current scope, as "through" the scope label or as "whole book", together with the control for widening it. The book's conversation list SHALL show each conversation's scope for that book. Conversations created before reading scope existed SHALL be shown as whole book.

#### Scenario: Header shows scope
- **WHEN** a reader opens a conversation scoped through Chapter 22
- **THEN** the header shows "Through Chapter 22" and a control to widen it

#### Scenario: List shows scope
- **WHEN** a reader opens a book's conversation list containing one bounded and one whole-book conversation
- **THEN** each entry shows its scope

#### Scenario: Existing conversation
- **WHEN** a reader opens a conversation created before this change
- **THEN** its scope is shown as whole book

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

### Requirement: Offer to update the reading position after widening
When the reader widens a conversation's scope for a book past that book's reading position, or while the position is unset, the system SHALL offer to set the reading position to the new scope. Declining SHALL leave the position unchanged. Accepting SHALL set the position as an ordinary forward move. Widening SHALL NOT change the position without the reader accepting.

#### Scenario: Widen past position
- **WHEN** the position is Chapter 12 and the reader widens a conversation to Chapter 18
- **THEN** the system offers to update the position to Chapter 18, and the position stays at Chapter 12 unless the reader accepts

#### Scenario: Widen within position
- **WHEN** the position is Chapter 20 and the reader widens a conversation from Chapter 10 to Chapter 15
- **THEN** no offer is made

### Requirement: Partway choices listed before whole book
Every control that asks the reader to choose a reading unit or the whole book SHALL list the reading-unit choices first and the whole-book choice last. This applies to starting a conversation from the dialog or the book page composer, widening a scope, setting the reading position, choosing the Guide's bound, and choosing a note's "as of" point.

#### Scenario: New-conversation order
- **WHEN** a reader opens the new-conversation dialog
- **THEN** the partway choice appears above "whole book"

#### Scenario: Other pickers follow the same order
- **WHEN** a reader opens the reading-position control, the widen-scope control, or the composer's scope control
- **THEN** the partway choice appears above "whole book"

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

### Requirement: Scope for each book in the composer
When the composer holds several books, each book SHALL have its own scope, shown with that book, following "Scope in the book page composer" for that book alone: it SHALL default to the book's reading position, it SHALL be changeable by saving the book's reading position or for this conversation only, and a scope chosen for this conversation only SHALL be discarded when the book is removed from the composer or the reader leaves the page. Changing one book's scope SHALL NOT change another's. When the reader sends and one or more books have no reading position, the scope choices SHALL open for each such book in turn, in the order the books were added, before anything is created. Dismissing any of them SHALL create nothing and SHALL keep the typed message and the books in the composer. A stale scope for any book SHALL create nothing and SHALL ask the reader to choose again for that book.

#### Scenario: Two books with positions
- **WHEN** "Infinite Jest" is at "Year of Glad" and "The Pale King" is finished, and the reader sends a question about both
- **THEN** the conversation is created with "Infinite Jest" through "Year of Glad" and "The Pale King" as whole book

#### Scenario: One book without a position
- **WHEN** the reader sends a question about two books and the second has no reading position
- **THEN** the scope choices open for the second book only, and after the reader chooses Chapter 4 the conversation is created with both books

#### Scenario: Dismiss the second book's choices
- **WHEN** the scope choices open for a book without a position and the reader dismisses them
- **THEN** no conversation is created, and the question and both books are still in the composer

#### Scenario: Scope for one book only
- **WHEN** the reader sets "Infinite Jest" to Chapter 3 for this conversation only
- **THEN** the scope shown for "The Pale King" does not change, and neither book's reading position changes
