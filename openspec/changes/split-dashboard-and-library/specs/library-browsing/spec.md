## ADDED Requirements

### Requirement: Dashboard
The page at the site root SHALL be titled "Dashboard" and SHALL show, in order, the Continue section and the Reading section. It SHALL NOT show the library list, its count, the library search, the status filter, or the upload and rescan actions; those are on the Library page. When the library holds no editions, the dashboard SHALL say that there are no books yet and SHALL link to the Library page to upload one. When the library holds editions but neither section has anything to show, the dashboard SHALL link to the Library page.

#### Scenario: Dashboard with activity
- **WHEN** the reader has recent conversations and is reading two books
- **THEN** the dashboard shows the Continue section followed by the Reading section, and no search box, status filter, or upload action

#### Scenario: Empty library
- **WHEN** a reader opens the dashboard and no books have been imported
- **THEN** the dashboard says there are no books yet and links to the Library page to upload one

#### Scenario: Books but nothing in progress
- **WHEN** the library holds books, none is being read, and no conversation exists
- **THEN** the dashboard shows neither section and links to the Library page

### Requirement: Reading section on the dashboard
When at least one edition is in the Reading state (a ready edition with a reading position that is not finished, as on the library list), the dashboard SHALL show a "Reading" section listing those editions, most recently updated reading position first, with at most four on wider viewports and at most two on narrow viewports. Each book SHALL show its cover (or a placeholder), title, authors, and its reading position as "Through" followed by the position's label, and selecting it SHALL open the book's page. The section SHALL link to the Library page filtered to Reading. When no edition is in the Reading state, the section SHALL NOT be shown. Unavailable, processing, and failed editions SHALL NOT be shown in the section.

#### Scenario: Most recent position first
- **WHEN** the reader set a position in "Mrs Dalloway" yesterday and in "Infinite Jest" today
- **THEN** the Reading section shows "Infinite Jest" before "Mrs Dalloway"

#### Scenario: Position shown on the card
- **WHEN** the reader's position in "Infinite Jest" is set through "Chapter 3"
- **THEN** its card shows "Through Chapter 3", and selecting it opens the book's page

#### Scenario: More books than fit
- **WHEN** six books are being read and the reader opens the dashboard on a desktop
- **THEN** the four with the most recently updated positions are shown, with a link that opens the Library filtered to Reading

#### Scenario: On a phone
- **WHEN** three books are being read and the reader opens the dashboard at 360 pixels wide
- **THEN** two books are shown

#### Scenario: Finished and unstarted books
- **WHEN** the library holds only finished books and books with no reading position
- **THEN** the dashboard shows no Reading section

#### Scenario: Unavailable book with a position
- **WHEN** a book with an unfinished reading position has no available source file
- **THEN** it is not shown in the Reading section

### Requirement: Continue conversations from the dashboard
When at least one conversation exists, the dashboard SHALL show a "Continue" section with the three most recently active conversations, across all books, using the rows of the conversations page (see literary-conversations), and a link to the conversations page. When no conversation exists, the section SHALL NOT be shown. The section SHALL be shown whether or not AI is configured. Deleting or renaming a conversation from the section SHALL update it without a reload.

#### Scenario: Pick up the latest conversation
- **WHEN** the reader opens the dashboard after talking about "Infinite Jest" an hour ago
- **THEN** that conversation is first in the Continue section, and selecting it opens it

#### Scenario: More than three conversations
- **WHEN** five conversations exist
- **THEN** the Continue section shows the three most recently active and a link to see all conversations

#### Scenario: No conversations
- **WHEN** no conversation exists
- **THEN** the dashboard shows no Continue section

### Requirement: Dashboard, library, and conversations navigation
The library list, its count, search, status filter, and the upload and rescan actions SHALL be on a Library page at `/library`, titled "Library", with the search and filter kept in that page's URL. Opening the site root with a library search or status filter in its URL SHALL redirect to the Library page with the same search and filter, without leaving the root URL in the browser history. The app header SHALL hold a navigation with three entries, Dashboard, Library, and Conversations, on every page except the login page. The entry for the current page SHALL be marked, visibly and for assistive technology; the Library entry SHALL be current whatever its search and filter, and on other pages, such as a book or a conversation, no entry SHALL be marked. The app name in the header SHALL lead to the dashboard. The book page SHALL NOT show its own link back to the dashboard or the library. On narrow viewports the navigation SHALL be in the header's menu (see responsive-layout).

#### Scenario: Switch to the library
- **WHEN** the reader selects Library from the dashboard
- **THEN** the Library page opens with the full library list, and Library is marked as the current page

#### Scenario: From a book to conversations
- **WHEN** the reader is on a book's page and selects Conversations in the header
- **THEN** the conversations page opens

#### Scenario: Nothing marked on other pages
- **WHEN** the reader opens a conversation
- **THEN** the header offers Dashboard, Library, and Conversations and none is marked as the current page

#### Scenario: Old library link
- **WHEN** a reader opens the site root with a search for "woolf" and the Finished filter in its URL
- **THEN** the Library page opens with "woolf" in the search box and Finished selected, and the browser's back action does not return to the root URL

#### Scenario: Back to a filtered library
- **WHEN** the reader filters the Library to Reading, goes to Conversations, and then uses the browser's back action
- **THEN** the Library shows the Reading filter again

#### Scenario: Filtered library marks Library
- **WHEN** the reader opens the Library with a search active
- **THEN** Library is marked as the current page

## MODIFIED Requirements

### Requirement: Delete a book from its detail page
The book's About tab SHALL offer an action to delete the book. The action SHALL require explicit confirmation that names the book, states that the deletion cannot be undone, and, when the book has a source in a library directory, states that the file in that directory is kept and will be skipped by future scans. After a successful deletion the user SHALL be returned to the Library page, which no longer shows the book.

#### Scenario: Confirm deletion
- **WHEN** a user chooses to delete a book and confirms
- **THEN** the book is deleted and the user is taken to the Library page, which no longer includes it

#### Scenario: Cancel deletion
- **WHEN** a user chooses to delete a book and then cancels the confirmation
- **THEN** nothing is deleted and the About tab remains open

#### Scenario: Confirmation for a book in a library directory
- **WHEN** a user starts deleting a book that has a library directory source
- **THEN** the confirmation states that the file in the library directory will not be removed and that scans will skip it

#### Scenario: Book already deleted elsewhere
- **WHEN** a user confirms deletion of a book that was deleted in another tab
- **THEN** the user is taken to the Library page without an error that blocks them

#### Scenario: Open a deleted book's links
- **WHEN** a user opens the detail page URL, any tab URL, the cover URL, or a passage URL of a deleted book
- **THEN** the page or response reports not found

## REMOVED Requirements

### Requirement: Continue conversations from the library
**Reason**: The Continue section moves from the combined library page to the dashboard, which no longer has a library search or filter for it to be independent of.
**Migration**: See "Continue conversations from the dashboard".

### Requirement: Dashboard and conversations navigation
**Reason**: The library list moves to its own page, so the navigation gains a Library entry and the site root stops serving library search URLs directly.
**Migration**: See "Dashboard, library, and conversations navigation"; old `/` search URLs redirect to `/library`.
