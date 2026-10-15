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

### Requirement: Delete a book from its detail page
The book detail page SHALL offer an action to delete the book. The action SHALL require explicit confirmation that names the book, states that the deletion cannot be undone, and, when the book has a source in a library directory, states that the file in that directory is kept and will be skipped by future scans. After a successful deletion the user SHALL be returned to the library list, which no longer shows the book.

#### Scenario: Confirm deletion
- **WHEN** a user chooses to delete a book and confirms
- **THEN** the book is deleted and the user is taken to the library list, which no longer includes it

#### Scenario: Cancel deletion
- **WHEN** a user chooses to delete a book and then cancels the confirmation
- **THEN** nothing is deleted and the book detail page remains open

#### Scenario: Confirmation for a book in a library directory
- **WHEN** a user starts deleting a book that has a library directory source
- **THEN** the confirmation states that the file in the library directory will not be removed and that scans will skip it

#### Scenario: Book already deleted elsewhere
- **WHEN** a user confirms deletion of a book that was deleted in another tab
- **THEN** the user is taken to the library list without an error that blocks them

#### Scenario: Open a deleted book's links
- **WHEN** a user opens the detail page URL, cover URL, or a passage URL of a deleted book
- **THEN** the page or response reports not found

### Requirement: Conversations entry point on book detail
The book detail page SHALL link to conversations containing that book and SHALL offer starting a new one. Starting a new one SHALL ask the reader to choose the conversation's scope (one of the book's reading units, or whole book) before the conversation is created. The book deletion confirmation SHALL state that conversations about only that book are deleted too.

#### Scenario: Start from a book
- **WHEN** a reader opens a book's detail page, chooses to start a conversation, and picks a scope
- **THEN** a new conversation about that book opens with that scope

#### Scenario: Cancel scope choice
- **WHEN** a reader chooses to start a conversation and then dismisses the scope choice
- **THEN** no conversation is created and the book detail page remains open

#### Scenario: Deletion warns about conversations
- **WHEN** a reader begins deleting a book that has conversations
- **THEN** the confirmation says conversations about only that book will be deleted

### Requirement: Passage reference actions
The passage view SHALL offer a reference action for each displayed passage, and for a non-whitespace text selection that lies wholly within the text of one passage. Selections that span passages, or that include footnote panels, navigation, or other page chrome, SHALL get no action. A selection reference SHALL identify its text by character offsets into that passage's text, and those offsets SHALL produce the same highlight when the reference's link is opened. The action SHALL offer:
- "Copy link", which copies the passage view URL for the passage, with the selection's range when there is one.
- "Discuss in a new conversation", which starts a conversation about the passage's book with the reference attached.
- "Add to a conversation", which lists the book's existing conversations with their scopes and opens the chosen one with the reference attached.

The action SHALL be reachable and operable by pointer, touch, and keyboard, SHALL have an accessible name, and SHALL NOT interfere with ordinary text selection and copying. Pressing Escape or clearing the selection SHALL dismiss a selection action. When AI is not configured, only "Copy link" SHALL be offered.

#### Scenario: Copy a passage link
- **WHEN** the reader activates "Copy link" on a passage
- **THEN** the clipboard holds this instance's passage view URL for that passage's current locator, and the page confirms the copy

#### Scenario: Copy a selection link
- **WHEN** the reader selects a phrase inside one passage and activates "Copy link"
- **THEN** the copied URL includes the phrase's range, and opening it shows the passage with exactly that phrase highlighted

#### Scenario: Selection across passages
- **WHEN** the reader's selection spans two passages or includes a footnote panel
- **THEN** no selection reference action is offered

#### Scenario: Discuss in a new conversation
- **WHEN** the reader activates "Discuss in a new conversation" on a passage and chooses a scope
- **THEN** a conversation about the book is created and opened, with the passage attached to its composer

#### Scenario: Add to an existing conversation
- **WHEN** the reader activates "Add to a conversation" and picks one of the book's conversations
- **THEN** that conversation opens with the passage attached to its composer, and the existing draft is kept

#### Scenario: Keyboard use
- **WHEN** the reader moves through the passages with the keyboard
- **THEN** each passage's reference action can be focused and its options chosen without a pointer

#### Scenario: AI not configured
- **WHEN** AI is not configured on the instance
- **THEN** the reference action offers only "Copy link"
