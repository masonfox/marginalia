## ADDED Requirements

### Requirement: Conversations entry point on book detail
The book detail page SHALL link to conversations containing that book and SHALL offer starting a new one. The book deletion confirmation SHALL state that conversations about only that book are deleted too.

#### Scenario: Start from a book
- **WHEN** a reader opens a book's detail page and chooses to start a conversation
- **THEN** a new conversation about that book opens

#### Scenario: Deletion warns about conversations
- **WHEN** a reader begins deleting a book that has conversations
- **THEN** the confirmation says conversations about only that book will be deleted
