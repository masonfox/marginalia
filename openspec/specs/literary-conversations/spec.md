# literary-conversations Specification

## Purpose

Lets readers hold persistent, book-scoped conversations with an assistant that searches the text, cites verified passages, and pushes back where the text does not support a claim.

## Requirements

### Requirement: Book-scoped persistent conversations
The system SHALL let a reader start, list, resume, rename, and delete conversations, each scoped to a set of one or more books. A conversation started from the UI SHALL contain exactly one book for now, but the system SHALL NOT assume a single book in its retrieval, citations, or stored data. Messages SHALL be persisted so a conversation survives reloads and restarts. Deleting a book SHALL remove it from its conversations and SHALL delete any conversation left with no books.

#### Scenario: Resume a conversation
- **WHEN** a reader reopens a conversation after restarting the application
- **THEN** all earlier messages, tool activity, and citations are shown

#### Scenario: Conversations listed per book
- **WHEN** a reader opens a book's conversation list
- **THEN** only conversations containing that book are shown, most recently active first

#### Scenario: Delete a conversation
- **WHEN** a reader confirms deletion of a conversation
- **THEN** it and its messages are removed and other conversations are unaffected

### Requirement: Streaming responses
The system SHALL stream the assistant's reply to the browser as it is generated, and SHALL let the reader stop a generation. A stopped or interrupted generation SHALL be saved with what was produced and marked as incomplete. Only one generation SHALL run per conversation at a time.

#### Scenario: Incremental display
- **WHEN** the reader sends a message
- **THEN** the reply text appears progressively before generation finishes

#### Scenario: Stop generation
- **WHEN** the reader stops a generation partway
- **THEN** the partial reply is saved and marked incomplete

#### Scenario: Concurrent generation
- **WHEN** a message is sent while another generation is running in the same conversation
- **THEN** the second request is rejected without altering the conversation

#### Scenario: Provider error
- **WHEN** the provider returns an error
- **THEN** the error is shown in the conversation, no partial claim is presented as verified, and the reader can retry

### Requirement: Retrieval through tools
The system SHALL give the model tools to search the conversation's books, read a passage by locator with surrounding context, and view the book's outline, all backed by the existing retrieval layer. The tools SHALL be restricted to the books in the conversation, SHALL identify the book for each result, SHALL cap result sizes and counts, and SHALL apply each book's position bound when one is set. The outline SHALL include only entries whose passage is revealed at or before the bound, and SHALL state that the book continues beyond the reader's scope. Tool calls and results SHALL be stored and visible to the reader.

#### Scenario: Model searches the book
- **WHEN** the reader asks about a scene
- **THEN** the model can call the search tool and the call appears in the conversation as tool activity

#### Scenario: Other book rejected
- **WHEN** the model asks to read a locator belonging to a book that is not in the conversation
- **THEN** the tool refuses and returns no text from that book

#### Scenario: Several books in one conversation
- **WHEN** a conversation contains two books and the model searches without naming one
- **THEN** results come from both books, each labeled with its book, and each book's own bound is respected

#### Scenario: Superseded or removed locator
- **WHEN** the model reads a locator that was superseded or removed by a reparse
- **THEN** the tool result states which, so the model can recover

#### Scenario: Bounded tool loop
- **WHEN** the model keeps calling tools
- **THEN** generation stops after the configured maximum number of steps with a final or incomplete reply

#### Scenario: Bounded outline
- **WHEN** a book in the conversation is scoped through Chapter 22 and the model requests its outline
- **THEN** the outline lists no entry after Chapter 22 and states that the book continues beyond the reader's scope

### Requirement: Verified citations
The system SHALL have the model cite passages by locator and exact quote, and SHALL verify every citation on the server against the stored passage text before presenting it as verified. Each citation SHALL be stored with its verification result. Citations that cannot be verified (unknown locator, removed passage, a book not in the conversation, or quote not found) SHALL be shown as unverified and SHALL NOT be presented as text from the book.

#### Scenario: Valid citation
- **WHEN** the model cites a passage with a quote that appears in it, ignoring whitespace, case, and typographic variants
- **THEN** the citation is shown as verified and links to that passage in the passage view

#### Scenario: Fabricated quote
- **WHEN** the model cites a locator with a quote that does not appear in that passage
- **THEN** the citation is shown as unverified

#### Scenario: Citation survives reparse
- **WHEN** a book is reparsed after a conversation was saved
- **THEN** the stored citations still link to the passages now holding their text

#### Scenario: Malformed citation marker
- **WHEN** the model emits a citation marker that cannot be parsed
- **THEN** it is shown as plain text and not as a verified citation

### Requirement: Evidence distinguished from interpretation
The assistant SHALL be instructed to separate what the text says, supported by cited passages, from its own interpretation, to label interpretation as such, and to say so when it finds no textual support. Cited evidence SHALL be visually distinct from uncited text in the conversation view.

#### Scenario: Answer with evidence and reading
- **WHEN** the reader asks what a passage implies
- **THEN** the reply presents cited text separately from labeled interpretation

#### Scenario: No supporting text found
- **WHEN** searches return nothing supporting the reader's claim
- **THEN** the reply states that the text support was not found rather than asserting it

### Requirement: Challenging discussion stance
The assistant SHALL be instructed to engage critically: offering its own reading, disagreeing with the reader when the text does not support their view, raising passages that complicate it, avoiding flattery, and conceding when the text supports the reader. The prompt version SHALL be recorded with each assistant message.

#### Scenario: Weak reading
- **WHEN** the reader proposes an interpretation contradicted by the text
- **THEN** the assistant says so and cites the contradicting passage

### Requirement: Spoiler notice
When starting a conversation, and in a whole-book conversation's view, the system SHALL tell the reader that the assistant may reveal any part of the book. In a conversation where every book is bounded, the system SHALL instead state that the assistant can read only through each book's scope and is instructed not to discuss later events, but may know the book from its training. Each book in a conversation SHALL carry an optional position bound that, when set, limits every retrieval tool to that book's passages revealed at or before it.

#### Scenario: Notice on new conversation
- **WHEN** a reader starts or opens a conversation in which a book's scope is whole book
- **THEN** a notice states that the assistant has access to the whole book

#### Scenario: Notice on bounded conversation
- **WHEN** a reader opens a conversation scoped through Chapter 22
- **THEN** no whole-book notice is shown, and a short note states the scope and that the assistant may still know the book from its training

#### Scenario: Bound applied
- **WHEN** a book in a conversation has a position bound
- **THEN** search and read tools return no passage of that book beyond it

### Requirement: Conversation access control
Conversation pages and endpoints SHALL be protected by the same instance access rules as the rest of the application.

#### Scenario: Unauthenticated chat request
- **WHEN** a request to the chat endpoint has no valid session on a password-protected instance
- **THEN** it is rejected and nothing is stored or sent to the provider

### Requirement: Scope stated to the model
For each bounded book, the system prompt SHALL name the scope label the reader has read through and SHALL instruct the model not to reveal, hint at, or speculate about events after it, including from its own knowledge of the book, and to say so when a question cannot be answered within the scope. For whole-book books the system prompt SHALL keep the existing spoiler courtesy. The system prompt SHALL depend only on the conversation's books and their scopes, so it is identical across turns until a scope changes. The prompt version SHALL change with this behavior.

#### Scenario: Bounded prompt
- **WHEN** a conversation is scoped through Chapter 22
- **THEN** the system prompt states that the reader has read through Chapter 22 and forbids revealing later events

#### Scenario: Question beyond the scope
- **WHEN** a reader scoped through Chapter 22 asks how a character's story ends
- **THEN** the assistant says it can only discuss the book through Chapter 22 rather than describing the ending

#### Scenario: Stable prompt between turns
- **WHEN** two consecutive messages are sent in a conversation whose scope did not change
- **THEN** both use the same system prompt text
