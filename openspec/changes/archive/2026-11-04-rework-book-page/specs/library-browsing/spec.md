## MODIFIED Requirements

### Requirement: Book detail and table of contents
The system SHALL show a book page made of a header shared by all of its tabs and four tabs: Discuss, Guide, Contents, and About. Each tab SHALL have its own URL, so it can be reloaded, linked, and reached with the browser's back and forward buttons. The book's URL SHALL open Discuss. The header SHALL show the cover when there is one, the title, the authors, and, when the edition is not ready, its import status and any import error. The tab bar SHALL mark the current tab, both visibly and to assistive technology, and SHALL be operable from the keyboard. The Contents tab SHALL show the nested table of contents, where each entry navigates to the passage it points to. The About tab SHALL show the description, metadata, sources (upload or library path, and whether each is available), passage count, and parser version. When the edition is not ready, the Guide tab SHALL NOT be offered, and Discuss SHALL show the import status instead of the composer.

#### Scenario: Navigate to a chapter
- **WHEN** a user selects a chapter on the Contents tab
- **THEN** the passage view opens at that chapter's first passage

#### Scenario: Book opens on Discuss
- **WHEN** a reader opens a ready book from the library
- **THEN** the header and the Discuss tab are shown, and Discuss is marked as the current tab

#### Scenario: Tab survives reload
- **WHEN** a reader opens the About tab and reloads the page
- **THEN** the About tab is shown again

#### Scenario: Metadata on About
- **WHEN** a reader opens the About tab
- **THEN** the book's description, metadata, sources with availability, passage count, and parser version are shown

#### Scenario: Book still importing
- **WHEN** a reader opens a book that is still importing
- **THEN** the header shows its import status, no Guide tab is offered, and Discuss shows no composer

### Requirement: In-book search UI
The system SHALL provide a search box on the book's Contents tab that runs a full-text search within that edition and lists results with highlighted snippets and section titles, each linking to the passage view. The query SHALL be kept in the tab's URL. A book URL that carries a search query SHALL redirect to the Contents tab with the same query.

#### Scenario: Search and open a result
- **WHEN** a user searches within a book and selects a result
- **THEN** the passage view opens at that result's locator

#### Scenario: No results
- **WHEN** a search matches nothing
- **THEN** the UI states that no passages matched

#### Scenario: Old search link
- **WHEN** a user opens a book URL with a search query saved before this change
- **THEN** they land on the Contents tab with that search run

### Requirement: Delete a book from its detail page
The book's About tab SHALL offer an action to delete the book. The action SHALL require explicit confirmation that names the book, states that the deletion cannot be undone, and, when the book has a source in a library directory, states that the file in that directory is kept and will be skipped by future scans. After a successful deletion the user SHALL be returned to the library list, which no longer shows the book.

#### Scenario: Confirm deletion
- **WHEN** a user chooses to delete a book and confirms
- **THEN** the book is deleted and the user is taken to the library list, which no longer includes it

#### Scenario: Cancel deletion
- **WHEN** a user chooses to delete a book and then cancels the confirmation
- **THEN** nothing is deleted and the About tab remains open

#### Scenario: Confirmation for a book in a library directory
- **WHEN** a user starts deleting a book that has a library directory source
- **THEN** the confirmation states that the file in the library directory will not be removed and that scans will skip it

#### Scenario: Book already deleted elsewhere
- **WHEN** a user confirms deletion of a book that was deleted in another tab
- **THEN** the user is taken to the library list without an error that blocks them

#### Scenario: Open a deleted book's links
- **WHEN** a user opens the detail page URL, any tab URL, the cover URL, or a passage URL of a deleted book
- **THEN** the page or response reports not found

### Requirement: Conversations entry point on book detail
For a ready edition, the Discuss tab SHALL show a composer for starting a new conversation about the book, followed by the list of conversations containing that book (see literary-conversations). Sending from the composer SHALL create the conversation with the scope shown in the composer (see reading-scope) and the chosen model, open it, and send the typed message as its first message. Each listed conversation SHALL open when selected, and SHALL offer rename and delete from one actions control. When AI is not configured, or the model a new conversation would use cannot be resolved, the composer SHALL be replaced by the notice that says so and points to Settings, and the list SHALL still be shown. The former conversation list URL SHALL redirect to the Discuss tab. The book deletion confirmation SHALL state that conversations about only that book are deleted too.

#### Scenario: Start from a book
- **WHEN** a reader whose position in a book is Chapter 3 types a question on its Discuss tab and sends it
- **THEN** a new conversation about that book, scoped through Chapter 3, opens with the question sent as its first message

#### Scenario: Cancel scope choice
- **WHEN** a reader with no reading position sends a question from the composer and then dismisses the scope choice
- **THEN** no conversation is created, the Discuss tab remains open, and the question is still in the composer

#### Scenario: Continue a conversation
- **WHEN** a reader selects a conversation in the Discuss tab's list
- **THEN** that conversation opens

#### Scenario: AI not configured
- **WHEN** a reader opens the Discuss tab on an instance with no configured provider
- **THEN** the setup notice is shown in place of the composer and the book's existing conversations are still listed

#### Scenario: Old conversations link
- **WHEN** a reader opens the book's former conversation list URL
- **THEN** they are redirected to the book's Discuss tab

#### Scenario: Deletion warns about conversations
- **WHEN** a reader begins deleting a book that has conversations
- **THEN** the confirmation says conversations about only that book will be deleted

### Requirement: Preprocessing on book detail
When AI is configured, the book's Guide tab SHALL show the edition's preprocessing status, progress while running, the model used, and its last error, together with the estimated spend (tokens and cost, labeled as an estimate). It SHALL offer an action to start preprocessing, or to regenerate it when stale, partly failed, or cancelled. The action SHALL warn that the whole book is sent to the provider. While a job is queued or running, the tab SHALL instead offer an action to cancel it, noting that finished sections are kept. Status SHALL update without a manual reload while a job is active. When AI is not configured the tab SHALL show no preprocessing status or action. Editions that are not ready SHALL NOT offer the action.

#### Scenario: Start from the page
- **WHEN** a reader starts preprocessing on a ready book from its Guide tab
- **THEN** status shows queued, then running with progress, then complete

#### Scenario: Spend shown
- **WHEN** preprocessing has completed
- **THEN** the Guide tab shows its estimated cost and token counts

#### Scenario: Stale
- **WHEN** a book was reparsed after preprocessing
- **THEN** the Guide tab shows it as stale with an action to regenerate

#### Scenario: Cancel from the page
- **WHEN** a reader cancels preprocessing that is running
- **THEN** status shows cancelled with the finished sections counted, and an action to resume

#### Scenario: AI not configured
- **WHEN** no provider is configured
- **THEN** no preprocessing action or status is shown

### Requirement: Reading position and Guide on book detail
For a ready edition, the book page header SHALL show the reading position on every tab: a unit label, "Finished", or "Not set". With it the header SHALL show progress: when a unit is set, which unit it is out of how many and a bar for the share of the book's passages through it; when finished, a full bar; when unset, no bar. The header SHALL offer a control to set, advance, move back, or clear the position, following the reading-position rules, and the header SHALL update as soon as the position changes anywhere on the page. The Guide SHALL be offered as a tab. Editions that are not ready SHALL offer neither.

#### Scenario: Set position from the book page
- **WHEN** a reader opens a ready book with no position and sets it to Chapter 3 from the header
- **THEN** the header shows the position as Chapter 3 with its progress

#### Scenario: Progress shown
- **WHEN** a book with 28 units has its position set to the 12th unit
- **THEN** the header says it is unit 12 of 28 and shows a bar for the share of the book's passages through it

#### Scenario: Position visible on every tab
- **WHEN** a reader moves from Discuss to Contents
- **THEN** the header still shows the reading position and its progress

#### Scenario: Open the Guide
- **WHEN** a reader selects the Guide tab on a ready book
- **THEN** the book's Guide opens
