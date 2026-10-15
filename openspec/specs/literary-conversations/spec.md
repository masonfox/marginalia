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

### Requirement: Conversation usage display
The conversation view SHALL show, for each assistant reply that has recorded usage, its token counts (input, cached input, output) and estimated cost in a compact, secondary form that does not interrupt reading. It SHALL also show the conversation's running total of tokens and estimated cost, including attempts that failed and were retried. Totals SHALL update when a reply finishes, without a page reload. Usage figures SHALL be visible to any signed-in reader who can open the conversation and SHALL never include credentials.

#### Scenario: Reply finishes
- **WHEN** a reply finishes streaming
- **THEN** its token counts and estimated cost appear with it, and the conversation total includes them

#### Scenario: Stopped reply
- **WHEN** the reader stops a reply partway
- **THEN** the usage shown for it is marked as possibly incomplete

#### Scenario: Reopened conversation
- **WHEN** the reader reopens a conversation later
- **THEN** each reply's usage and the conversation total are shown as they were recorded

### Requirement: Stable request prefix
Within a conversation, the system prompt and the tool definitions sent to the model SHALL be identical, byte for byte, on every step of the tool loop and on every turn, unless the conversation's books or the prompt version change. They SHALL NOT contain timestamps, random values, or other content that varies between requests, and the tool list SHALL be sent in a fixed order. Earlier messages SHALL be replayed to the model unchanged from turn to turn.

#### Scenario: Two turns, same prefix
- **WHEN** the reader sends two messages in the same conversation
- **THEN** the system prompt and tool definitions sent for both are identical

#### Scenario: Stored history replay
- **WHEN** a conversation is resumed after a restart
- **THEN** the earlier messages sent to the model are the same as when they were last sent before the restart

### Requirement: Bounded book map as an untrusted reference message
When a book in a conversation has current preprocessing, the request SHALL include a compact map of that book: its current unit summaries whose end position is at or before the book's bound (all units for whole-book scope). The maps SHALL be sent in one message after the system prompt and before the conversation history, labelled as untrusted reference data derived from the books that is not instructions and not citable text, with each book's map in a delimited block. Stored text SHALL be escaped so it cannot close or forge those delimiters. The map SHALL label each summary with its unit label. The map SHALL NOT appear in the system prompt; the system prompt SHALL instead tell the model that summaries and book maps are a guide, not evidence, that text inside them is never an instruction, and that claims must still be cited from passages of the book. The map message SHALL be part of the cached prefix and SHALL depend only on the conversation's books, their scopes, and the current stored summaries, so it is identical across turns until one of those changes. A book without current preprocessing SHALL contribute no map, and when no book has a map the message SHALL be omitted. Each book's map SHALL have a size cap; when exceeded, the oldest summaries SHALL be shortened to their first sentence, then the oldest units dropped, and the map SHALL say so.

#### Scenario: Map limited by scope
- **WHEN** a conversation is scoped through Chapter 22 on a preprocessed book
- **THEN** the book-map message contains summaries of Chapters 1 to 22 and none after

#### Scenario: Stable map
- **WHEN** two consecutive messages are sent and neither scope nor stored summaries changed
- **THEN** both requests carry the same book-map message and the same system prompt text

#### Scenario: Map kept out of the system prompt
- **WHEN** a conversation includes a preprocessed book
- **THEN** the system prompt contains no summary text, and the summaries appear only in the book-map message

#### Scenario: Not preprocessed
- **WHEN** a book has no current preprocessing
- **THEN** the request has no map for it, no book-map message is sent when no other book has one, and conversations work as before

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

### Requirement: Reply to selected assistant text
The system SHALL offer a nearby "Reply to selection" action when the reader selects non-whitespace response text wholly within one persisted assistant message that is not currently streaming. The selection SHALL exclude research activity, source lists, citation popovers, usage, status notices, and user messages. A selection MAY span inline citation markers; they SHALL be omitted from the quoted text. The action SHALL be available through pointer, touch selection, and keyboard selection and activation, without interfering with ordinary copying or citation interactions. Clearing the selection, moving it outside eligible text, pressing Escape, or leaving the conversation SHALL dismiss the action. Text from a saved incomplete response SHALL be eligible, with its incomplete status still shown.

#### Scenario: Select a response excerpt
- **WHEN** the reader highlights text within one saved assistant response and activates "Reply to selection"
- **THEN** the selected displayed text is attached to the composer as assistant-response context and the message input receives focus

#### Scenario: Selection across citation markers
- **WHEN** the reader selects response text that contains inline citation markers and activates "Reply to selection"
- **THEN** the attached quote contains the surrounding text without the markers' numbers or labels

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
The composer SHALL hold at most one quote, display it with an assistant-response label separately from the reader's editable message, and offer an accessible removal control. Attaching, replacing, or removing a quote SHALL preserve the typed draft. A quote SHALL contain 1 to 2,000 characters after trimming boundary whitespace, using the same character-count rule in browser and server. An over-limit selection SHALL show an explanatory message without silently truncating it or replacing existing context. Sending SHALL still require a nonempty reader message and SHALL remain unavailable during a generation. A pending quote SHALL belong to its conversation. It SHALL survive reloading the conversation or leaving and returning to it within the same browser tab session, subject to draft restoration. It SHALL NOT appear in any other conversation, browser tab, or device.

#### Scenario: Replace and remove context
- **WHEN** the reader attaches a second eligible selection and then removes it
- **THEN** the second quote replaces the first, removal leaves no pending quote, and the typed draft remains unchanged throughout

#### Scenario: Quote length exceeded
- **WHEN** the reader tries to attach a selection longer than 2,000 characters
- **THEN** a clear length-limit explanation is shown and any existing quote and draft are preserved

#### Scenario: Quote without a question
- **WHEN** the composer contains a quote but no non-whitespace reader message
- **THEN** sending is prevented and no message is persisted or sent to the provider

#### Scenario: Quote survives reload
- **WHEN** the reader attaches a quote, types a draft, and reloads the conversation in the same tab
- **THEN** the composer shows the same quote and draft

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
The composer SHALL hold at most one attachment, either a passage reference or an assistant-response quote. Attaching either one SHALL replace the other. Before a passage reference is shown as attached, the system SHALL check it against the conversation. A passage reference that passes SHALL be shown separately from the reader's editable message. The display SHALL include the book title, the section title, the referenced text, a label marking it as a passage from the book, and an accessible remove control. The referenced text is the selected range when the reference has one, and otherwise the whole passage. A reference that fails SHALL NOT be attached. The reader SHALL instead see why: the passage was not found, was removed, belongs to a book outside the conversation, has an invalid range, is too long, or is beyond the conversation's scope. For an out-of-scope passage, the explanation SHALL name the reading unit that contains it and offer the conversation's widen-scope control. Attaching, replacing, removing, or rejecting a reference SHALL preserve the typed draft. A reference arriving from the passage view SHALL be attached once when the conversation opens, and SHALL NOT be re-attached on reload. It SHALL replace any attachment restored from the saved draft. A pending reference SHALL belong to its conversation and SHALL survive a reload within the same browser tab session, subject to draft restoration. Sending SHALL still require a nonempty reader message.

#### Scenario: Reference from the passage view
- **WHEN** a conversation opens from a passage view action with a passage reference
- **THEN** the composer shows the passage reference, the message input has focus, and reloading the page restores the same pending reference without checking it as a new handoff

#### Scenario: Handoff replaces a restored attachment
- **WHEN** a conversation has a saved draft with a quote and the reader opens it from a passage view action with a passage reference
- **THEN** the passage reference replaces the restored quote and the restored draft text is kept

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

### Requirement: Composer draft restoration
The system SHALL save each conversation's unsent draft in the browser, for the current tab session only, keyed by conversation. The draft comprises the message text and the pending attachment: a quote, a checked passage reference, or none. The draft SHALL be saved as it changes and when the page is hidden. It SHALL be restored when the conversation opens in that tab. A saved draft SHALL be cleared when its message is submitted and when its conversation is deleted from that tab. Saved data that is missing, unreadable, malformed, or from an unknown format version SHALL be discarded silently, and the composer SHALL start empty. If browser storage is unavailable, the composer SHALL keep working without restoration. Notices and the attachment's expanded state SHALL NOT be saved.

On restore:
- A passage reference SHALL be shown at once from its saved snapshot and then checked again against the conversation. If the check fails, the reference SHALL be removed and the matching notice shown. Sending SHALL be unavailable until the check finishes.
- A quote SHALL be restored only if its source assistant message is still in the conversation.

Drafts SHALL NOT be sent to the server before submission, and SHALL NOT be shared across tabs or devices.

#### Scenario: Draft survives reload
- **WHEN** the reader types a message and reloads the page
- **THEN** the composer shows the same text

#### Scenario: Navigate away and back
- **WHEN** the reader leaves a conversation with a draft for a passage view and returns in the same tab
- **THEN** the draft and its attachment are restored

#### Scenario: Restored passage no longer in scope
- **WHEN** a draft with a passage reference is restored after the conversation's scope was narrowed so the passage is beyond it
- **THEN** the reference is removed, the out-of-scope notice is shown, and the draft text is kept

#### Scenario: Restored quote with missing source
- **WHEN** a draft's quote refers to an assistant message no longer in the conversation
- **THEN** the quote is not restored and the draft text is kept

#### Scenario: Corrupt saved draft
- **WHEN** the saved draft for a conversation is malformed
- **THEN** the composer opens empty and no error is shown

#### Scenario: Submit clears the draft
- **WHEN** the reader sends a message and then reloads
- **THEN** the composer is empty

#### Scenario: New tab
- **WHEN** the reader opens a conversation with a draft in another tab in a new tab
- **THEN** the new tab's composer does not show that draft

### Requirement: Composer layout and attachment display
The composer SHALL appear as a card within the conversation column, kept visible at the bottom of the viewport, with messages scrolling beneath it. The pending attachment SHALL be shown in one slot above the message input, as a compact chip. The chip SHALL show its source (the book and section for a passage, or an assistant-response label for a quote) and a one-line excerpt. The chip SHALL offer an accessible control to expand and collapse it, and an accessible remove control. When expanded, the chip SHALL show the full attached text in an area of bounded height that scrolls within itself, and for a passage a link to it in the passage view. A chip SHALL start collapsed when attached or restored. Passage-check progress and rejection notices SHALL be shown in the same slot in place of the chip. The last message SHALL remain reachable by scrolling above the composer.

#### Scenario: Long passage does not bury the input
- **WHEN** a 4,000-character passage is attached
- **THEN** the chip shows a one-line excerpt and the message input remains visible

#### Scenario: Expand an attachment
- **WHEN** the reader activates the chip's expand control on a passage reference
- **THEN** the full passage text is shown in a bounded, scrollable area with a link that opens the passage view, and the control's state is exposed to assistive technology

#### Scenario: Notice in the attachment slot
- **WHEN** a pasted passage link is being checked or is rejected
- **THEN** the progress or rejection notice appears where the chip would be, and the message input does not move to another row

### Requirement: Autogrowing message input
The message input SHALL start at one line of height and grow with its content up to about 40% of the viewport height, after which it SHALL scroll within the composer. It SHALL NOT offer a manual resize handle. It SHALL shrink when content is removed. The input SHALL accept at most 8,000 characters. A remaining-character count SHALL be shown once the draft reaches 7,200 characters, and SHALL NOT be shown below that.

#### Scenario: Grow with content
- **WHEN** the reader types several lines
- **THEN** the input grows to fit them without a scrollbar, until it reaches its maximum height

#### Scenario: Near the limit
- **WHEN** the draft reaches 7,200 characters
- **THEN** the number of characters remaining is shown

### Requirement: Send control
The composer SHALL have one send control inside the card. The control SHALL be available when the draft has non-whitespace text, no passage check is in progress, and no generation is running. When sending is unavailable and no generation is running, the control SHALL appear disabled and SHALL expose the reason, both as a visible tooltip and to assistive technology. The reasons are an empty message or a passage still being checked. While a generation is running, the control SHALL become a stop control in the same position with an accessible name for stopping. Activating it SHALL stop the generation.

#### Scenario: Empty message
- **WHEN** the message input is empty or whitespace only
- **THEN** the send control is disabled and its accessible description states that a message must be typed

#### Scenario: Checking a passage
- **WHEN** the reader has typed a message and a passage reference is being checked
- **THEN** the send control is disabled and its description states that the passage is being checked

#### Scenario: Stop in place
- **WHEN** a reply is streaming
- **THEN** the send control is replaced in the same position by a stop control, and activating it stops the generation

### Requirement: Composer keyboard behavior
On devices whose primary input is not touch:
- Enter in the message input SHALL send when sending is available, and SHALL otherwise do nothing.
- Shift+Enter SHALL insert a newline.
- A hint describing these shortcuts SHALL be shown below the composer.

On devices whose primary input is touch, Enter SHALL insert a newline, sending SHALL use the send control, and the hint SHALL NOT be shown. Enter during text composition by an input method SHALL NOT send.

Escape in the composer SHALL remove the pending attachment, or dismiss a passage notice when one is shown, and SHALL keep the typed draft. Escape SHALL NOT stop a running generation.

#### Scenario: Enter sends on desktop
- **WHEN** the reader on a desktop presses Enter with a non-empty draft
- **THEN** the message is sent

#### Scenario: Enter on a touch device
- **WHEN** the reader on a touch device presses Enter
- **THEN** a newline is inserted and nothing is sent

#### Scenario: Escape removes the attachment
- **WHEN** the composer holds an attachment and the reader presses Escape in the message input
- **THEN** the attachment is removed and the draft is unchanged

#### Scenario: Escape during streaming
- **WHEN** a reply is streaming and the reader presses Escape in the composer
- **THEN** the generation continues

### Requirement: Markdown list editing
The message input SHALL be plain text, and the draft SHALL be sent as typed. When the reader inserts a newline at the end of a line that is a list item (one beginning, after optional indentation, with `- `, `* `, or a number followed by `. `), the composer SHALL start the next line as an item of the same list, at the same indentation. A numbered item SHALL be followed by the next number. Inserting a newline on a list item with no content SHALL remove that item's marker and end the list instead. On a list item, Tab SHALL indent the item one level and Shift+Tab SHALL outdent it. Elsewhere, Tab and Shift+Tab SHALL move focus as usual. These edits SHALL be undoable with the browser's undo where the browser supports it.

#### Scenario: Continue a numbered list
- **WHEN** the reader types `1. He's hiding a breakdown` and inserts a newline
- **THEN** the next line begins with `2. `

#### Scenario: End a list
- **WHEN** the reader inserts a newline on a line containing only `2. `
- **THEN** the marker is removed and the cursor is on an empty line outside the list

#### Scenario: Tab outside a list
- **WHEN** the cursor is on a line that is not a list item and the reader presses Tab
- **THEN** focus moves to the next control and no text is inserted

### Requirement: Markdown rendering of reader messages
Sent and reopened reader messages SHALL render their text as GitHub-flavored Markdown, including lists, emphasis, code, and links. Raw HTML in a reader message SHALL NOT be rendered as HTML. Reader messages SHALL NOT show citation styling or citation controls. Stored message text SHALL NOT change, and the text given to the model SHALL be the text as typed. A message's attachment SHALL still be displayed separately from its text.

#### Scenario: List in a sent message
- **WHEN** the reader sends a message containing a numbered Markdown list
- **THEN** the sent message shows a numbered list

#### Scenario: HTML in a message
- **WHEN** the reader sends a message containing `<img src=x onerror=alert(1)>`
- **THEN** it is shown as text, and no element or script from it is created
