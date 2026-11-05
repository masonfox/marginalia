## ADDED Requirements

### Requirement: Conversations listed across books
The system SHALL provide a conversations page that lists every conversation, whatever its books, most recently active first, with the most recently created first among those equally recent. The list SHALL load in pages and SHALL load the next page when the reader scrolls near the end, without a pagination control, until every conversation is shown. A conversation SHALL appear at most once in the list while the reader scrolls, even when conversations are created, updated, or deleted in the meantime. Each row SHALL show the conversation's title, its books (see "Book labels in conversation lists"), its message count, when it was last active, and the same one-line preview as a book's conversation list (see "Conversation list preview"). Each row SHALL open its conversation when selected, and SHALL offer rename and delete from one actions control. When there are no conversations, the page SHALL say so and explain that conversations are started from a book. The page SHALL be protected by the instance access rules.

#### Scenario: Conversations from several books
- **WHEN** the reader has conversations about "Infinite Jest" and "To the Lighthouse", the latter most recently active
- **THEN** the conversations page lists both, the "To the Lighthouse" conversation first

#### Scenario: Scroll to load more
- **WHEN** there are more conversations than the first page holds and the reader scrolls to the end of the list
- **THEN** the next conversations, in the same order, are added, and loading stops after the last one

#### Scenario: Activity while scrolling
- **WHEN** a conversation already shown in the list receives a new message in another tab while the reader scrolls
- **THEN** it is not shown a second time

#### Scenario: Rename from the list
- **WHEN** the reader renames a conversation from its row's actions
- **THEN** the row shows the new title

#### Scenario: No conversations
- **WHEN** the reader opens the conversations page before any conversation exists
- **THEN** the page says there are no conversations yet and that they are started from a book

### Requirement: Book labels in conversation lists
A row in a list of conversations that is not about one book SHALL name the conversation's books in their stored order. A conversation with one book SHALL show its title and its scope. A conversation with two books SHALL show both titles. A conversation with three or more books SHALL show the first title followed by "+N", where N is the number of other books. The row's accessible name SHALL include every book's title and scope. Titles SHALL be rendered as text, never as HTML, and a long label SHALL be truncated to fit one line.

#### Scenario: One book
- **WHEN** a conversation about "Infinite Jest" scoped through "Year of Glad" is listed
- **THEN** the row shows "Infinite Jest" with "Through Year of Glad"

#### Scenario: Two books
- **WHEN** a conversation about "Infinite Jest" and "The Pale King" is listed
- **THEN** the row shows both titles

#### Scenario: Three books
- **WHEN** a conversation about three books, the first "Infinite Jest", is listed
- **THEN** the row shows "Infinite Jest +2", and its accessible name includes all three titles with their scopes
