## MODIFIED Requirements

### Requirement: Book-scoped persistent conversations
The system SHALL let a reader start, list, resume, rename, and delete conversations, each scoped to a set of one or more books. A conversation started from the UI SHALL contain from one to three distinct ready books, in the order the reader added them, and the system SHALL NOT assume a single book in its retrieval, citations, or stored data. Creating a conversation SHALL be all or nothing: when any of its books is missing or not ready, or any book's scope is stale, no conversation SHALL be created and the reader SHALL be told which book needs attention. Messages SHALL be persisted so a conversation survives reloads and restarts. A book's conversations SHALL be listed on the book page's Discuss tab, including conversations that also contain other books. Deleting a book SHALL remove it from its conversations and SHALL delete any conversation left with no books.

#### Scenario: Resume a conversation
- **WHEN** a reader reopens a conversation after restarting the application
- **THEN** all earlier messages, tool activity, and citations are shown

#### Scenario: Conversations listed per book
- **WHEN** a reader opens a book's Discuss tab
- **THEN** only conversations containing that book are shown, most recently active first

#### Scenario: Delete a conversation
- **WHEN** a reader confirms deletion of a conversation
- **THEN** it and its messages are removed and other conversations are unaffected

#### Scenario: Start about two books
- **WHEN** a reader starts a conversation about "Infinite Jest" and "The Pale King"
- **THEN** one conversation is created containing both books, and it is listed on both books' Discuss tabs

#### Scenario: More than three books
- **WHEN** a request to start a conversation names four books
- **THEN** it is rejected and nothing is created

#### Scenario: One book not ready
- **WHEN** a reader starts a conversation about two books and one of them was deleted in another tab
- **THEN** no conversation is created and the reader is told which book is no longer available

#### Scenario: Deleting one of two books
- **WHEN** a book is deleted that shares a conversation with another book
- **THEN** the conversation remains, containing only the other book

### Requirement: Spoiler notice
When starting a conversation, and in a conversation's view, the system SHALL tell the reader, for each book whose scope is whole book, that the assistant may reveal any part of that book. When every book in a conversation is bounded, the system SHALL instead state that the assistant can read only through each book's scope and is instructed not to discuss later events, but may know the books from its training. When a conversation has both bounded and whole-book books, the notice SHALL name the whole-book books as fully readable and the bounded books with their scopes. Each book in a conversation SHALL carry an optional position bound that, when set, limits every retrieval tool to that book's passages revealed at or before it.

#### Scenario: Notice on new conversation
- **WHEN** a reader starts or opens a conversation in which a book's scope is whole book
- **THEN** a notice states that the assistant has access to the whole book

#### Scenario: Notice on bounded conversation
- **WHEN** a reader opens a conversation scoped through Chapter 22
- **THEN** no whole-book notice is shown, and a short note states the scope and that the assistant may still know the book from its training

#### Scenario: Mixed scopes
- **WHEN** a reader opens a conversation with "Infinite Jest" through "Year of Glad" and "The Pale King" as whole book
- **THEN** the notice says the assistant may reveal any part of "The Pale King" and can read "Infinite Jest" only through "Year of Glad"

#### Scenario: Bound applied
- **WHEN** a book in a conversation has a position bound
- **THEN** search and read tools return no passage of that book beyond it
