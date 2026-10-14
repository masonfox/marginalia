## MODIFIED Requirements

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

## ADDED Requirements

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
