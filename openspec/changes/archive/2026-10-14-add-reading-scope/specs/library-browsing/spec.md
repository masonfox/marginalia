## MODIFIED Requirements

### Requirement: Conversations entry point on book detail
The book detail page SHALL link to conversations containing that book and SHALL offer starting a new one. Starting a new one SHALL ask the reader to choose the conversation's scope (one of the book's reading units, or whole book) before the conversation is created. The book deletion confirmation SHALL state that conversations about only that book are deleted too.

#### Scenario: Start from a book
- **WHEN** a reader opens a book's detail page, chooses to start a conversation, and picks a scope
- **THEN** a new conversation about that book opens with that scope

#### Scenario: Cancel scope choice
- **WHEN** a reader chooses to start a conversation and then dismisses the scope choice
- **THEN** no conversation is created and the book detail page remains open

#### Scenario: Deletion warns about conversations
- **WHEN** a reader begins deleting a book that has conversations
- **THEN** the confirmation says conversations about only that book will be deleted
