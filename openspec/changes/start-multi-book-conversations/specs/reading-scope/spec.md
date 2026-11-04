## ADDED Requirements

### Requirement: Scope for each book in the composer
When the composer holds several books, each book SHALL have its own scope, shown with that book, following "Scope in the book page composer" for that book alone: it SHALL default to the book's reading position, it SHALL be changeable by saving the book's reading position or for this conversation only, and a scope chosen for this conversation only SHALL be discarded when the book is removed from the composer or the reader leaves the page. Changing one book's scope SHALL NOT change another's. When the reader sends and one or more books have no reading position, the scope choices SHALL open for each such book in turn, in the order the books were added, before anything is created. Dismissing any of them SHALL create nothing and SHALL keep the typed message and the books in the composer. A stale scope for any book SHALL create nothing and SHALL ask the reader to choose again for that book.

#### Scenario: Two books with positions
- **WHEN** "Infinite Jest" is at "Year of Glad" and "The Pale King" is finished, and the reader sends a question about both
- **THEN** the conversation is created with "Infinite Jest" through "Year of Glad" and "The Pale King" as whole book

#### Scenario: One book without a position
- **WHEN** the reader sends a question about two books and the second has no reading position
- **THEN** the scope choices open for the second book only, and after the reader chooses Chapter 4 the conversation is created with both books

#### Scenario: Dismiss the second book's choices
- **WHEN** the scope choices open for a book without a position and the reader dismisses them
- **THEN** no conversation is created, and the question and both books are still in the composer

#### Scenario: Scope for one book only
- **WHEN** the reader sets "Infinite Jest" to Chapter 3 for this conversation only
- **THEN** the scope shown for "The Pale King" does not change, and neither book's reading position changes
