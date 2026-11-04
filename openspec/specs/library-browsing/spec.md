# library-browsing Specification

## Purpose

Gives the reader a minimal web interface to see their library and import status, navigate a book's structure, read passages by locator, and search within a book.

## Requirements

### Requirement: Library list
The system SHALL list editions in title order (case-insensitive), each with cover thumbnail (or a placeholder), title, authors, and one status. An edition that is processing, failed, or unavailable SHALL show that status, and a failed edition SHALL show the failure reason with an action to retry. A ready edition SHALL show its reading state instead: "Not started" when it has no reading position, "Finished" when its position is finished, and "Reading" otherwise. The list SHALL show how many editions the library holds.

#### Scenario: Mixed statuses
- **WHEN** the library contains one processing book, one failed book, and one ready book with no reading position
- **THEN** the books show Processing, Failed, and Not started, and the failed book shows its reason and a retry action

#### Scenario: Reading states
- **WHEN** the library contains ready books with no position, a position at Chapter 3, and a finished position
- **THEN** they show Not started, Reading, and Finished, and none of them shows "Ready"

#### Scenario: Unavailable book with a position
- **WHEN** a ready book with a reading position has no available source file
- **THEN** it shows Unavailable

#### Scenario: Empty library
- **WHEN** no books have been imported
- **THEN** the library shows guidance to upload a book or configure a library directory

### Requirement: Library list loads as the reader scrolls
The library list SHALL load editions in pages and SHALL load the next page when the reader scrolls near the end of the loaded books, without a pagination control, until every matching edition is shown. An edition SHALL appear at most once while the reader scrolls, even when books are imported or deleted in the meantime. The list SHALL remain usable for libraries of up to 5,000 editions. When the reader opens a book and returns with the browser's back action, the list SHALL show the same search, filter, and loaded books.

#### Scenario: Scroll to load more
- **WHEN** the library holds more books than the first page and the reader scrolls to the end of the list
- **THEN** the next books in title order are added to the list, and loading stops after the last book

#### Scenario: Import during scrolling
- **WHEN** a book whose title sorts before the loaded books finishes importing while the reader scrolls
- **THEN** no book already in the list appears a second time

#### Scenario: Back from a book
- **WHEN** the reader has scrolled past the first page, opens a book, and goes back
- **THEN** the library shows the same books loaded, with the same search and filter

### Requirement: Search the library by title and author
The library page SHALL provide a search box that narrows the list to editions whose title, or any of whose authors, contains the search text, ignoring case and surrounding whitespace. Results SHALL keep title order and load as the reader scrolls. The list SHALL update as the reader types, without a submit action. While a search is active, the count SHALL show the matching books out of the library total. The search text SHALL be kept in the page URL, so reloading or opening the URL shows the same results, and typing SHALL NOT add a browser history entry for every change.

#### Scenario: Search by title
- **WHEN** the reader types "lighthouse" and the library contains "To the Lighthouse"
- **THEN** the list shows that book, and the count reads as matching books out of the total

#### Scenario: Search by author
- **WHEN** the reader types "woolf"
- **THEN** every book with an author whose name contains "Woolf" is listed, and no other book

#### Scenario: Shared link
- **WHEN** a reader opens the library URL that includes a search
- **THEN** the search box holds that text and the list shows its results

#### Scenario: No match
- **WHEN** a search matches no book
- **THEN** the page says that no books match and offers to clear the search and filter, instead of the upload guidance

### Requirement: Filter the library by status
The library page SHALL offer a status filter with the options All, Not started, Reading, Finished, and Needs attention. Not started, Reading, and Finished SHALL match ready editions in that reading state. Needs attention SHALL match editions that are processing, failed, or unavailable. Needs attention SHALL be offered only while at least one edition is in one of those states, or while it is the selected filter. The filter SHALL combine with the search, so a book is listed only when it matches both. The filter SHALL be kept in the page URL like the search.

#### Scenario: Filter to books being read
- **WHEN** the reader chooses Reading
- **THEN** only ready books with a reading position that is not finished are listed

#### Scenario: Filter with search
- **WHEN** the reader chooses Finished and searches "woolf"
- **THEN** only finished books by an author matching "woolf", or with a title matching it, are listed

#### Scenario: Needs attention
- **WHEN** one import has failed and the reader chooses Needs attention
- **THEN** the failed book is listed with its reason and retry action, and ready books are not

#### Scenario: Nothing needs attention
- **WHEN** every book is ready
- **THEN** the filter does not offer Needs attention

#### Scenario: Status changes while filtered
- **WHEN** the reader filters to Needs attention and a processing book finishes importing
- **THEN** the book leaves the list within a few seconds without a reload

### Requirement: Import status updates
The library view SHALL reflect status changes of in-progress imports without a manual page reload.

#### Scenario: Ingestion completes while viewing
- **WHEN** a book finishes ingestion while the library view is open
- **THEN** its status changes to ready within a few seconds without reloading the page

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

### Requirement: Deletion warns about reader guide content
When an edition has reader notes, corrections, or confirmed subjects, the deletion confirmation SHALL state that they will be deleted too.

#### Scenario: Book with notes
- **WHEN** a reader begins deleting a book that has reader notes
- **THEN** the confirmation says the book's notes and guide edits will be deleted
