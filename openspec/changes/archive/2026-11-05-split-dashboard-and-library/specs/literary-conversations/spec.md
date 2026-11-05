## MODIFIED Requirements

### Requirement: Conversation list preview
Each conversation in a book's list SHALL show its title, a one-line preview of the text of its most recent message that has text, whether from the reader or the assistant, and, on one line below the preview, its scope for that book and when it was last active. When it was last active SHALL be shown relative to now (such as "3 hours ago" or "yesterday"), with the exact date and time available on hover. When that line does not fit, the scope SHALL be truncated so that when it was last active stays visible. The row SHALL NOT show the conversation's message count. The preview SHALL be plain text, with markdown markup and line breaks removed, and SHALL be truncated to fit one line. Tool activity, citation markers, and attachments SHALL NOT appear in the preview. A conversation with no message text SHALL show that it has no messages yet. The preview SHALL be rendered as text, never as HTML.

#### Scenario: Preview of the latest reply
- **WHEN** a conversation's most recent message is an assistant reply beginning "**Hal** is reading the dictionary because"
- **THEN** its row shows "Hal is reading the dictionary because…" on one line

#### Scenario: Latest message has no text
- **WHEN** a conversation's most recent assistant message failed before producing text
- **THEN** the preview shows the text of the latest earlier message that has text

#### Scenario: Empty conversation
- **WHEN** a conversation has no messages
- **THEN** its row says it has no messages yet

#### Scenario: Markup in a message
- **WHEN** a message's text contains HTML tags
- **THEN** the preview shows them as literal text

#### Scenario: Last active relative to now
- **WHEN** a conversation was last active three hours ago
- **THEN** its row shows "3 hours ago", shows the exact date and time on hover, and does not show its message count

### Requirement: Conversations listed across books
The system SHALL provide a conversations page that lists every conversation, whatever its books, most recently active first, with the most recently created first among those equally recent. The list SHALL load in pages and SHALL load the next page when the reader scrolls near the end, without a pagination control, until every conversation is shown. A conversation SHALL appear at most once in the list while the reader scrolls, even when conversations are created, updated, or deleted in the meantime. Each row SHALL show the conversation's book covers (see "Book labels in conversation lists"), its title, the same one-line preview as a book's conversation list (see "Conversation list preview"), and, on one line below the preview, its books (see "Book labels in conversation lists") and when it was last active, shown as on a book's conversation list. Each row SHALL open its conversation when selected, and SHALL offer rename and delete from one actions control. When there are no conversations, the page SHALL say so and explain that conversations are started from a book. The page SHALL be protected by the instance access rules.

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

Such a row SHALL also show, at its start, a stack of the conversation's book covers in their stored order, the first book in front and each other book partly visible behind it. A book without a cover SHALL be shown by a placeholder with the first letter of its title. The stack SHALL take the same width whatever the number of books, so the rows' text stays aligned. The stack SHALL be hidden from assistive technology, since the row's text already names every book.

#### Scenario: One book
- **WHEN** a conversation about "Infinite Jest" scoped through "Year of Glad" is listed
- **THEN** the row shows "Infinite Jest" with "Through Year of Glad"

#### Scenario: Two books
- **WHEN** a conversation about "Infinite Jest" and "The Pale King" is listed
- **THEN** the row shows both titles

#### Scenario: Three books
- **WHEN** a conversation about three books, the first "Infinite Jest", is listed
- **THEN** the row shows "Infinite Jest +2", and its accessible name includes all three titles with their scopes

#### Scenario: Cover stack
- **WHEN** a conversation about "Infinite Jest", which has a cover, and "The Pale King", which has none, is listed
- **THEN** the row starts with the "Infinite Jest" cover in front and a placeholder showing "T" behind it, and the stack is not announced by assistive technology
