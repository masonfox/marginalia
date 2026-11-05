## ADDED Requirements

### Requirement: Continue conversations from the library
When at least one conversation exists, the library page SHALL show a "Continue" section above the library list with the three most recently active conversations, across all books, using the rows of the conversations page (see literary-conversations), and a link to the conversations page. When no conversation exists, the section SHALL NOT be shown. The section SHALL be shown whether or not AI is configured, and SHALL NOT be affected by the library search or status filter. Deleting or renaming a conversation from the section SHALL update it without a reload.

#### Scenario: Pick up the latest conversation
- **WHEN** the reader opens the library after talking about "Infinite Jest" an hour ago
- **THEN** that conversation is first in the Continue section, and selecting it opens it

#### Scenario: More than three conversations
- **WHEN** five conversations exist
- **THEN** the Continue section shows the three most recently active and a link to see all conversations

#### Scenario: No conversations
- **WHEN** no conversation exists
- **THEN** the library page shows no Continue section

#### Scenario: Search does not hide it
- **WHEN** the reader searches the library for a title that has no conversations
- **THEN** the Continue section still shows the most recent conversations

### Requirement: Dashboard and conversations navigation
The page at the site root, which holds the Continue section and the library list, SHALL be titled "Dashboard". The app header SHALL hold a navigation with two entries, Dashboard and Conversations, on every page except the login page. The entry for the current page SHALL be marked for assistive technology, and on other pages, such as a book or a conversation, neither entry SHALL be marked. The library's search and filter URLs at the site root SHALL keep working. The app name in the header SHALL lead to the dashboard. The book page SHALL NOT show its own link back to the dashboard. On narrow viewports the navigation SHALL take its own row in the header, below the app name, with both entries on that row and touch-sized targets (see responsive-layout).

#### Scenario: Switch to conversations
- **WHEN** the reader selects Conversations from the dashboard
- **THEN** the conversations page opens and Conversations is marked as the current page

#### Scenario: From a book to conversations
- **WHEN** the reader is on a book's page and selects Conversations in the header
- **THEN** the conversations page opens

#### Scenario: Nothing marked on other pages
- **WHEN** the reader opens a conversation
- **THEN** the header shows Dashboard and Conversations and neither is marked as the current page

#### Scenario: Back to a filtered library
- **WHEN** the reader filters the library to Reading, goes to Conversations, and then uses the browser's back action
- **THEN** the library shows the Reading filter again

#### Scenario: Navigation on a phone
- **WHEN** the reader opens the library at 360 pixels wide
- **THEN** both navigation entries are visible on one row below the app name, without horizontal page scrolling
