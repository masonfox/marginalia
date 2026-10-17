## ADDED Requirements

### Requirement: Reading position and Guide on book detail
For a ready edition, the book detail page SHALL show the reading position (a unit label, "Finished", or "Not set") with a control to set, advance, move back, or clear it, following the reading-position rules. The page SHALL also show an entry point to the book's Guide. Editions that are not ready SHALL offer neither.

#### Scenario: Set position from the book page
- **WHEN** a reader opens a ready book with no position and sets it to Chapter 3
- **THEN** the page shows the position as Chapter 3

#### Scenario: Open the Guide
- **WHEN** a reader follows the Guide entry point on a ready book
- **THEN** the book's Guide opens

### Requirement: Deletion warns about reader guide content
When an edition has reader notes, corrections, or confirmed subjects, the deletion confirmation SHALL state that they will be deleted too.

#### Scenario: Book with notes
- **WHEN** a reader begins deleting a book that has reader notes
- **THEN** the confirmation says the book's notes and guide edits will be deleted
