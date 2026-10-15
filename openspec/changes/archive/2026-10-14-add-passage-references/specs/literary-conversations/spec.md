## ADDED Requirements

### Requirement: Passage link recognition
When the reader pastes text into the message composer and the pasted text, trimmed, is a single passage view URL for this instance, the composer SHALL attach it as a passage reference instead of inserting the text. Recognised forms are an absolute URL with this instance's origin and a root-relative path, either one with an optional highlight range. All other pasted text, including passage links inside longer text and links to other origins, SHALL be inserted unchanged. Recognition SHALL depend only on the URL's form. Whether the passage can be referenced SHALL be decided by the attach-time check.

#### Scenario: Paste a passage link
- **WHEN** the reader pastes `https://<this instance>/p/<locator>?hl=10-42` into the composer
- **THEN** no URL text is inserted, and a passage reference for that locator and range is attached

#### Scenario: Link inside longer text
- **WHEN** the reader pastes a sentence that contains a passage link
- **THEN** the sentence is inserted unchanged and no reference is attached

#### Scenario: Link to another site
- **WHEN** the reader pastes a URL on a different origin whose path looks like a passage link
- **THEN** it is inserted as text

### Requirement: Pending passage reference
The composer SHALL hold at most one attachment, either a passage reference or an assistant-response quote. Attaching either one SHALL replace the other. Before a passage reference is shown as attached, the system SHALL check it against the conversation. A passage reference that passes SHALL be shown separately from the reader's editable message: the book title, section title, and referenced text, a label marking it as a passage from the book, and an accessible remove control. The referenced text is the selected range when the reference has one, and otherwise the whole passage. A reference that fails SHALL NOT be attached. The reader SHALL instead see why: the passage was not found, was removed, belongs to a book outside the conversation, has an invalid range, is too long, or is beyond the conversation's scope. For an out-of-scope passage, the explanation SHALL name the reading unit that contains it and offer the conversation's widen-scope control. Attaching, replacing, removing, or rejecting a reference SHALL preserve the typed draft. A reference arriving from the passage view SHALL be attached once when the conversation opens, and SHALL NOT be re-attached on reload. Pending references SHALL be local to the current conversation. Sending SHALL still require a nonempty reader message.

#### Scenario: Reference from the passage view
- **WHEN** a conversation opens from a passage view action with a passage reference
- **THEN** the composer shows the passage preview, the message input has focus, and reloading the page does not attach the reference again

#### Scenario: Replace a reply quote
- **WHEN** the composer holds an assistant-response quote and the reader pastes a passage link
- **THEN** the passage reference replaces the quote and the draft is unchanged

#### Scenario: Out-of-scope passage
- **WHEN** a conversation is scoped through Chapter 5 and the reader attaches a passage from Chapter 9
- **THEN** no reference is attached, the reader is told the passage is in Chapter 9, beyond the conversation's scope, and the widen-scope control is offered

#### Scenario: Attach after widening
- **WHEN** the reader widens that conversation's scope to Chapter 9 or later and attaches the same passage again
- **THEN** the reference is attached

#### Scenario: Reference without a question
- **WHEN** the composer holds a passage reference but no non-whitespace message
- **THEN** sending is prevented and nothing is stored or sent to the provider

### Requirement: Passage reference validation
The system SHALL accept an optional passage reference with a new user message. A reference comprises a locator and an optional character range. A request SHALL NOT carry both a passage reference and an assistant-response quote. Before storing the message or contacting the provider, the system SHALL resolve the locator, following locators from earlier parser versions to their current passage. It SHALL reject the reference when any of the following holds:
- The locator cannot be resolved, or its passage was removed.
- The passage's book is not in the conversation.
- The range is empty, reversed, or outside the current passage text.
- The referenced text exceeds 4,000 characters.
- The passage is revealed after the conversation's bound for that book.

An out-of-scope rejection SHALL be distinguishable from other rejections and SHALL identify the reading unit that contains the passage. A rejected reference SHALL produce a client-visible error without appending a message or starting generation. The referenced text SHALL be taken from the stored book, never from the client.

#### Scenario: Server scope check
- **WHEN** a request bypasses the browser and references a passage after the conversation's bound
- **THEN** the request is rejected as out of scope, and no message is stored and no provider call is made

#### Scenario: Book outside the conversation
- **WHEN** a request references a passage of a book that is not in the conversation
- **THEN** the request is rejected and no message is stored

#### Scenario: Superseded locator
- **WHEN** a request references a locator from an earlier parse that maps to a current passage within scope
- **THEN** the reference is accepted and stored with the current locator

#### Scenario: Both quote and reference
- **WHEN** a request carries both an assistant-response quote and a passage reference
- **THEN** the request is rejected without storing a message

### Requirement: Persistent passage reference
A valid passage reference SHALL be stored with its user message as a snapshot. The snapshot holds the current locator, the range if any, the book and section titles, and the referenced text as it was when sent. Sent and reopened history SHALL show the snapshot separately from the reader's message, styled as text from the book and linked to the passage view, with the range highlighted. A later reparse SHALL NOT change the displayed snapshot. The link SHALL follow the passage view's normal forwarding for superseded and removed locators. Messages without a reference SHALL behave as before.

#### Scenario: Send and reopen
- **WHEN** the reader sends a message with a passage reference and later reopens the conversation
- **THEN** the message shows the same passage text, book, and section, with a link that opens the passage view at that passage and range

### Requirement: Passage reference replay
The system SHALL give the stored passage snapshot to the model with its user message, separately from the reader's message. The snapshot SHALL be labelled as a passage the reader is referring to, quoted from the book, and SHALL include its locator. The system prompt and tool definitions SHALL NOT change, and the reference SHALL NOT widen the conversation's scope. Citations the model makes to the referenced passage SHALL be verified like any other citation. Replaying history or retrying a failed generation SHALL replay the same snapshot once. A failed submission before persistence SHALL keep a way to retry or edit the message with its reference intact.

#### Scenario: Model receives the passage
- **WHEN** the reader sends a question with a passage reference
- **THEN** the provider receives the passage text, labelled with its locator as reader-referenced book text, alongside the question, and the system prompt and tools are unchanged

#### Scenario: Citing the referenced passage
- **WHEN** the reply cites the referenced passage's locator with a quote from it
- **THEN** the citation is shown as verified

#### Scenario: Retry a failed reply
- **WHEN** generation fails after the message and reference were saved and the reader retries
- **THEN** the same message and snapshot are replayed once and no new user message is appended

#### Scenario: Edit a failed submission
- **WHEN** sending fails before the message is stored and the reader chooses to edit it
- **THEN** the composer is restored with the original text and passage reference
