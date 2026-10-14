## ADDED Requirements

### Requirement: Bounded book map in the system prompt
When a book in a conversation has current preprocessing, the system prompt SHALL include a compact map of that book: the unit summaries whose end position is at or before the book's bound (all units for whole-book scope). The map SHALL label each summary with its unit label and SHALL state that it is a guide, not evidence, and that claims must still be cited from the text. The map SHALL be part of the cached prefix and SHALL depend only on the conversation's books, their scopes, and the current stored summaries, so it is identical across turns until one of those changes. A book without current preprocessing SHALL contribute no map. The map SHALL have a size cap; when exceeded, summaries SHALL be shortened or dropped in a stated, deterministic way.

#### Scenario: Map limited by scope
- **WHEN** a conversation is scoped through Chapter 22 on a preprocessed book
- **THEN** the system prompt contains summaries of Chapters 1 to 22 and none after

#### Scenario: Stable map
- **WHEN** two consecutive messages are sent and neither scope nor stored summaries changed
- **THEN** both use the same system prompt text

#### Scenario: Not preprocessed
- **WHEN** a book has no current preprocessing
- **THEN** the prompt has no map for it and conversations work as before

#### Scenario: Scope widened
- **WHEN** the reader widens the scope
- **THEN** later messages include the summaries up to the new bound

### Requirement: Observation lookup tool
The system SHALL give the model a tool that looks up observations for a character, place, object, or motif by name within a book of the conversation. The tool SHALL return only observations at or before the book's bound, in reading order, each with its unit label, note, and citations with verification state. It SHALL cap result counts and sizes, SHALL refuse books not in the conversation, SHALL report when the book has no current preprocessing, and SHALL be sent in the fixed tool order. Tool calls and results SHALL be stored and visible like other tools.

#### Scenario: Lookup within scope
- **WHEN** the model looks up a character in a conversation scoped through Chapter 10
- **THEN** only observations from Chapters 1 to 10 are returned

#### Scenario: Name not found
- **WHEN** no observation matches the name
- **THEN** the result says none were found and suggests searching the text

#### Scenario: Other book rejected
- **WHEN** the model passes a book that is not in the conversation
- **THEN** the tool refuses and returns no data

#### Scenario: Not preprocessed
- **WHEN** the book has no current preprocessing
- **THEN** the result states that observations are unavailable

### Requirement: Derived data is not citable evidence
The prompt SHALL instruct the assistant that summaries and observations are a guide and SHALL NOT be cited as text of the book. Citations in answers SHALL still be made to passages and verified as before. The prompt version SHALL change with this behavior.

#### Scenario: Answer from a summary
- **WHEN** the assistant relies on a summary to answer
- **THEN** it reads or searches the text and cites a passage, and a summary is never presented as a verified citation
