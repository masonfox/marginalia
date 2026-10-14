# library-browsing Specification

## Purpose

Gives the reader a minimal web interface to see their library and import status, navigate a book's structure, read passages by locator, and search within a book.

## Requirements

### Requirement: Library list
The system SHALL display all editions with cover thumbnail (or a placeholder), title, authors, and status (processing, ready, failed, or unavailable), and SHALL show the failure reason for failed imports with an action to retry.

#### Scenario: Mixed statuses
- **WHEN** the library contains one ready, one processing, and one failed book
- **THEN** each is listed with its status, and the failed book shows its reason and a retry action

#### Scenario: Empty library
- **WHEN** no books have been imported
- **THEN** the library shows guidance to upload a book or configure a library directory

### Requirement: Import status updates
The library view SHALL reflect status changes of in-progress imports without a manual page reload.

#### Scenario: Ingestion completes while viewing
- **WHEN** a book finishes ingestion while the library view is open
- **THEN** its status changes to ready within a few seconds without reloading the page

### Requirement: Book detail and table of contents
The system SHALL show a book detail page with its metadata, sources (upload or library path, and whether each is available), passage count, parser version, and its nested table of contents, where each entry navigates to the passage it points to.

#### Scenario: Navigate to a chapter
- **WHEN** a user selects a chapter in the table of contents
- **THEN** the passage view opens at that chapter's first passage

### Requirement: Passage view by locator
The system SHALL provide a shareable URL for any passage locator that displays the passage highlighted within its surrounding section text, along with its section title and position, and allows moving to the previous and next section.

#### Scenario: Open a citation link
- **WHEN** a user opens the URL for a passage locator
- **THEN** the section is displayed, scrolled to the passage, with the passage visually highlighted

#### Scenario: Footnote reference
- **WHEN** a displayed passage references a footnote
- **THEN** the user can open the footnote's text from the reference

#### Scenario: Link to a superseded locator
- **WHEN** a user opens the URL for a locator issued under an earlier parser version
- **THEN** the browser is redirected to the URL of the current locator and the mapped passage is shown highlighted

#### Scenario: Link to a removed passage
- **WHEN** a user opens the URL for a locator recorded as removed
- **THEN** the page states that the passage was moved or removed in a newer parse of the book and links to the book's table of contents

### Requirement: In-book search UI
The system SHALL provide a search box on the book detail page that runs a full-text search within that edition and lists results with highlighted snippets and section titles, each linking to the passage view.

#### Scenario: Search and open a result
- **WHEN** a user searches within a book and selects a result
- **THEN** the passage view opens at that result's locator

#### Scenario: No results
- **WHEN** a search matches nothing
- **THEN** the UI states that no passages matched
