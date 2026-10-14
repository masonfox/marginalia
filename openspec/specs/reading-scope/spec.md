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
Starting a conversation SHALL require the reader to choose how far they have read in each of its books: one of the book's reading units, or "whole book". No choice SHALL be preselected. Choosing a unit SHALL set that book's position bound to the unit's end position and record the unit's label as the scope's label. Choosing "whole book" SHALL leave the bound unset. The system SHALL reject a scope that does not match one of the book's current reading units.

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

### Requirement: Widening a conversation's scope
The reader SHALL be able to widen a book's scope in an existing conversation to a later reading unit or to "whole book". The system SHALL NOT offer narrowing and SHALL reject a request that would narrow the scope, because earlier replies may already contain later material. A generation already running when the scope is widened SHALL finish under the bound it started with. Later messages SHALL use the widened bound.

#### Scenario: Widen to a later chapter
- **WHEN** a conversation is scoped through Chapter 22 and the reader widens it to Chapter 30
- **THEN** the bound moves to the end of Chapter 30 and the next reply can retrieve passages from Chapters 23 to 30

#### Scenario: Only later units offered
- **WHEN** a reader opens the scope control of a conversation scoped through Chapter 22
- **THEN** the choices are the units after Chapter 22 and "whole book"

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
