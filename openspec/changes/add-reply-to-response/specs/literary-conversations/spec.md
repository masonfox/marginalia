## ADDED Requirements

### Requirement: Reply to selected assistant text
The system SHALL offer a nearby "Reply to selection" action when the reader selects non-whitespace response text wholly within one persisted assistant message that is not currently streaming. The selection SHALL exclude research activity, source lists, citation controls and popovers, usage, status notices, and user messages. The action SHALL be available through pointer, touch selection, and keyboard selection and activation, without interfering with ordinary copying or citation interactions. Clearing the selection, moving it outside eligible text, pressing Escape, or leaving the conversation SHALL dismiss the action. Text from a saved incomplete response SHALL be eligible, with its incomplete status still shown.

#### Scenario: Select a response excerpt
- **WHEN** the reader highlights text within one saved assistant response and activates "Reply to selection"
- **THEN** the selected displayed text is attached to the composer as assistant-response context and the message input receives focus

#### Scenario: Ineligible selection
- **WHEN** a selection is empty, spans multiple messages, includes excluded content, or belongs to a response still streaming or not yet persisted
- **THEN** no reply-to-selection action is offered

#### Scenario: Keyboard selection
- **WHEN** the reader selects eligible response text using the keyboard
- **THEN** the action is keyboard reachable, has an accessible name, and can be activated without losing the captured selection

#### Scenario: Dismiss the action
- **WHEN** the reader presses Escape or clears the selection
- **THEN** the selection action disappears without changing the message draft or its already attached quote

### Requirement: Pending reply context
The composer SHALL hold at most one quote, display its text and an assistant-response label separately from the reader's editable message, and offer an accessible removal control. Attaching, replacing, or removing a quote SHALL preserve the typed draft. A quote SHALL contain 1 to 2,000 characters after trimming boundary whitespace, using the same character-count rule in browser and server. An over-limit selection SHALL show an explanatory message without silently truncating it or replacing existing context. Sending SHALL still require a nonempty reader message and SHALL remain unavailable during a generation. Pending context SHALL be local to the current conversation and SHALL not survive leaving or reloading it.

#### Scenario: Replace and remove context
- **WHEN** the reader attaches a second eligible selection and then removes it
- **THEN** the second quote replaces the first, removal leaves no pending quote, and the typed draft remains unchanged throughout

#### Scenario: Quote length exceeded
- **WHEN** the reader tries to attach a selection longer than 2,000 characters
- **THEN** a clear length-limit explanation is shown and any existing quote and draft are preserved

#### Scenario: Quote without a question
- **WHEN** the composer contains a quote but no non-whitespace reader message
- **THEN** sending is prevented and no message is persisted or sent to the provider

### Requirement: Persistent assistant-response context
The system SHALL accept an optional quote with a new user message, comprising a source assistant message ID and selected text. Before storing the message or contacting the provider, the system SHALL reject malformed or empty quotes, quotes over 2,000 characters, sources absent from the current conversation, non-assistant sources, and sources still being generated. An invalid quote SHALL cause a client-visible validation error without appending a message. The selected text SHALL be treated as user-supplied context, not authenticated book evidence. Valid context SHALL be stored with the user message and displayed in sent and reopened history as a separate plain-text quote labeled as an assistant response. Older messages without context SHALL retain their current behavior.

#### Scenario: Send and reopen a reply
- **WHEN** the reader sends a message with a valid quote and later reopens the conversation
- **THEN** the user message shows the same quote and assistant-response label separately from the reader's message text

#### Scenario: Invalid quote source
- **WHEN** a request references a user message, an unknown message, or an assistant message in another conversation
- **THEN** the request is rejected with a validation error and neither a message append nor provider call occurs

#### Scenario: Server length validation
- **WHEN** a request bypasses the browser with empty or over-limit quote text
- **THEN** the server rejects it without storing a message or starting generation

### Requirement: Reply context replay
The system SHALL supply stored quote text with its associated user message to the model as explicitly labeled, user-supplied context from an earlier assistant response, separately from the reader's new message. This context SHALL NOT alter the system prompt or tool definitions, grant additional reading access, or confer verified citation status. Replaying history or retrying a failed generation SHALL preserve the same context and SHALL NOT duplicate the quote or append a second user message for a server-side generation retry. A failed submission before persistence SHALL retain a way to retry the complete message and quote.

#### Scenario: Model receives the selected context
- **WHEN** the reader sends a question with a quote
- **THEN** the provider receives the quote as labeled assistant-response context alongside that question, with the existing system prompt and tools unchanged

#### Scenario: Retry a failed reply
- **WHEN** generation fails after the user message and quote have been saved and the reader retries
- **THEN** the same stored question and quote are replayed once and no additional user message is appended

#### Scenario: Submission rejected before storage
- **WHEN** sending fails before the user message is persisted
- **THEN** the reader can retry or edit the original question with its quote intact

#### Scenario: Response quote is not evidence
- **WHEN** a quote contains an assistant claim or text resembling a citation marker
- **THEN** the quote remains visibly assistant-response context and receives no verified-book styling or citation status from the reply feature
