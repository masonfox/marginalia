## MODIFIED Requirements

### Requirement: Book-scoped persistent conversations
The system SHALL let a reader start, list, resume, rename, and delete conversations, each scoped to a set of one or more books. A conversation started from the UI SHALL contain exactly one book for now, but the system SHALL NOT assume a single book in its retrieval, citations, or stored data. Messages SHALL be persisted so a conversation survives reloads and restarts. A book's conversations SHALL be listed on the book page's Discuss tab. Deleting a book SHALL remove it from its conversations and SHALL delete any conversation left with no books.

#### Scenario: Resume a conversation
- **WHEN** a reader reopens a conversation after restarting the application
- **THEN** all earlier messages, tool activity, and citations are shown

#### Scenario: Conversations listed per book
- **WHEN** a reader opens a book's Discuss tab
- **THEN** only conversations containing that book are shown, most recently active first

#### Scenario: Delete a conversation
- **WHEN** a reader confirms deletion of a conversation
- **THEN** it and its messages are removed and other conversations are unaffected

## ADDED Requirements

### Requirement: Conversation list preview
Each conversation in a book's list SHALL show its title, its scope for that book, its message count, when it was last active, and a one-line preview of the text of its most recent message that has text, whether from the reader or the assistant. The preview SHALL be plain text, with markdown markup and line breaks removed, and SHALL be truncated to fit one line. Tool activity, citation markers, and attachments SHALL NOT appear in the preview. A conversation with no message text SHALL show that it has no messages yet. The preview SHALL be rendered as text, never as HTML.

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
