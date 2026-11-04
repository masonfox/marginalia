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

### Requirement: Library and conversations navigation
The library page and the conversations page SHALL share a navigation with two entries, Library and Conversations, that switches between them and marks the current page for assistive technology. The library SHALL remain at the site root, and its search and filter URLs SHALL keep working. The app name in the header SHALL keep leading to the library. On narrow viewports the navigation SHALL fit on one row with touch-sized targets.

#### Scenario: Switch to conversations
- **WHEN** the reader selects Conversations from the library page
- **THEN** the conversations page opens and Conversations is marked as the current page

#### Scenario: Back to a filtered library
- **WHEN** the reader filters the library to Reading, goes to Conversations, and then uses the browser's back action
- **THEN** the library shows the Reading filter again

#### Scenario: Navigation on a phone
- **WHEN** the reader opens the library at 360 pixels wide
- **THEN** both navigation entries are visible on one row without horizontal page scrolling
