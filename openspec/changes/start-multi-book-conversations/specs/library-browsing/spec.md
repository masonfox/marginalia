## ADDED Requirements

### Requirement: Start a conversation from the header
The app header SHALL offer a "New conversation" control on its right side, next to Settings, on every page except the login page. It SHALL open a dialog with the conversation composer holding no books, and the composer SHALL NOT be sendable until at least one book is added. Sending SHALL create the conversation, close the dialog, open the conversation, and send the typed message as its first message. Dismissing the dialog SHALL create nothing, and reopening it SHALL restore the typed message and the chosen books until the reader sends or clears them. When AI is not configured, or the model a new conversation would use cannot be resolved, the dialog SHALL show the notice that says so and points to Settings instead of the composer. On narrow viewports the control SHALL be icon-only with the accessible name "New conversation".

#### Scenario: Start from the library
- **WHEN** the reader selects New conversation on the library page, adds "Infinite Jest", types a question, and sends
- **THEN** a conversation about "Infinite Jest" opens with the question sent as its first message

#### Scenario: No book chosen
- **WHEN** the reader types a question in the header's composer without adding a book
- **THEN** the send action is unavailable and the composer asks for a book

#### Scenario: Dismiss and reopen
- **WHEN** the reader adds a book and types a question, closes the dialog, and opens it again
- **THEN** the book and the question are still there and no conversation was created

#### Scenario: AI not configured
- **WHEN** the reader selects New conversation on an instance with no configured provider
- **THEN** the dialog shows the setup notice pointing to Settings

### Requirement: Choosing books in the composer
The composer SHALL show the conversation's books above the message input, each with its title, its scope, and a control to remove it. While it holds fewer than three books it SHALL offer "Add book", which opens a picker that searches the library by title and author, lists only ready books not already in the composer, and loads more as the reader scrolls. The book page's Discuss composer SHALL start with that book and SHALL let the reader add others and remove any book except while it is the only one. Every control SHALL be reachable and operable by keyboard and touch.

#### Scenario: Add a second book from the book page
- **WHEN** on the "Infinite Jest" Discuss tab the reader adds "The Pale King" and sends a question
- **THEN** the conversation is created with "Infinite Jest" first and "The Pale King" second

#### Scenario: Picker hides unusable books
- **WHEN** the reader opens Add book while one book is processing and "Infinite Jest" is already in the composer
- **THEN** neither the processing book nor "Infinite Jest" is offered

#### Scenario: Three books
- **WHEN** the composer holds three books
- **THEN** Add book is not offered

#### Scenario: Remove a book
- **WHEN** the reader removes the second of two books before sending
- **THEN** the conversation is created with only the first book
