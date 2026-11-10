## MODIFIED Requirements

### Requirement: Streaming responses
The system SHALL stream the assistant's reply to the browser as it is generated, and SHALL let the reader stop a generation. A stopped or interrupted generation SHALL be saved with what was produced and marked as incomplete. Only one generation SHALL run per conversation at a time, counting the main conversation and all of its threads together.

#### Scenario: Incremental display
- **WHEN** the reader sends a message
- **THEN** the reply text appears progressively before generation finishes

#### Scenario: Stop generation
- **WHEN** the reader stops a generation partway
- **THEN** the partial reply is saved and marked incomplete

#### Scenario: Concurrent generation
- **WHEN** a message is sent while another generation is running in the same conversation
- **THEN** the second request is rejected without altering the conversation

#### Scenario: Concurrent generation across a thread
- **WHEN** a message is sent in the main conversation while a reply is streaming in one of its threads
- **THEN** the request is rejected without altering the conversation or the thread

#### Scenario: Provider error
- **WHEN** the provider returns an error
- **THEN** the error is shown in the conversation, no partial claim is presented as verified, and the reader can retry

### Requirement: Reply to selected assistant text
The system SHALL offer a nearby "Reply to selection" action when the reader selects non-whitespace response text wholly within one persisted assistant message that is not currently streaming, whether in the main conversation or in a thread. Activating it SHALL attach the quote to the composer of the place where the message is shown: the main conversation's composer for a main-conversation message, or the thread's composer for a thread message. The selection SHALL exclude research activity, source lists, citation popovers, usage, status notices, thread markers, anchor quotes, and user messages. A selection MAY span inline citation markers; they SHALL be omitted from the quoted text. The action SHALL be available through pointer, touch selection, and keyboard selection and activation, without interfering with ordinary copying or citation interactions. Clearing the selection, moving it outside eligible text, pressing Escape, or leaving the conversation SHALL dismiss the action. Text from a saved incomplete response SHALL be eligible, with its incomplete status still shown.

#### Scenario: Select a response excerpt
- **WHEN** the reader highlights text within one saved assistant response and activates "Reply to selection"
- **THEN** the selected displayed text is attached to the composer as assistant-response context and the message input receives focus

#### Scenario: Reply inside a thread
- **WHEN** the reader highlights text in a saved assistant reply inside a thread and activates "Reply to selection"
- **THEN** the text is attached to that thread's composer, and the main conversation's composer is unchanged

#### Scenario: Selection across citation markers
- **WHEN** the reader selects response text that contains inline citation markers and activates "Reply to selection"
- **THEN** the attached quote contains the surrounding text without the markers' numbers or labels

#### Scenario: Ineligible selection
- **WHEN** a selection is empty, spans multiple messages, spans the main conversation and a thread panel, includes excluded content, or belongs to a response still streaming or not yet persisted
- **THEN** no reply-to-selection action is offered

#### Scenario: Keyboard selection
- **WHEN** the reader selects eligible response text using the keyboard
- **THEN** the action is keyboard reachable, has an accessible name, and can be activated without losing the captured selection

#### Scenario: Dismiss the action
- **WHEN** the reader presses Escape or clears the selection
- **THEN** the selection action disappears without changing the message draft or its already attached quote

### Requirement: Pending reply context
Each composer SHALL hold at most one quote, display it with an assistant-response label separately from the reader's editable message, and offer an accessible removal control. Attaching, replacing, or removing a quote SHALL preserve the typed draft. A quote SHALL contain 1 to 2,000 characters after trimming boundary whitespace, using the same character-count rule in browser and server. An over-limit selection SHALL show an explanatory message without silently truncating it or replacing existing context. Sending SHALL still require a nonempty reader message and SHALL remain unavailable during a generation. A pending quote SHALL belong to its conversation and to the composer it was attached to: the main conversation or one thread. It SHALL survive reloading the conversation or leaving and returning to it within the same browser tab session, subject to draft restoration. It SHALL NOT appear in any other composer, conversation, browser tab, or device.

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

#### Scenario: Quotes kept apart per composer
- **WHEN** the reader has a quote pending in the main composer and attaches a different quote in a thread's composer
- **THEN** each composer keeps its own quote and neither replaces the other

### Requirement: Persistent assistant-response context
The system SHALL accept an optional quote with a new user message, comprising a source assistant message ID and selected text. Before storing the message or contacting the provider, the system SHALL reject malformed or empty quotes, quotes over 2,000 characters, sources absent from the current conversation, non-assistant sources, and sources still being generated. It SHALL also reject a quote attached to a thread message whose source is not in that thread. A quote attached to a main-conversation message MAY come from the main conversation or from any of its threads. An invalid quote SHALL cause a client-visible validation error without appending a message. The selected text SHALL be treated as user-supplied context, not authenticated book evidence. Valid context SHALL be stored with the user message and displayed in sent and reopened history as a separate plain-text quote labeled as an assistant response. A quote brought from a thread SHALL also show that it came from a thread and offer to open that thread. Older messages without context SHALL retain their current behavior.

#### Scenario: Send and reopen a reply
- **WHEN** the reader sends a message with a valid quote and later reopens the conversation
- **THEN** the user message shows the same quote and assistant-response label separately from the reader's message text

#### Scenario: Quote brought from a thread
- **WHEN** the reader sends a main-conversation message with a quote brought from a thread reply
- **THEN** the message is stored with the quote, labelled as an assistant response from a thread, with a control that opens that thread

#### Scenario: Thread quote from elsewhere
- **WHEN** a request attaches a quote to a thread message whose source is in the main conversation or another thread
- **THEN** the request is rejected with a validation error and neither a message append nor provider call occurs

#### Scenario: Invalid quote source
- **WHEN** a request references a user message, an unknown message, or an assistant message in another conversation
- **THEN** the request is rejected with a validation error and neither a message append nor provider call occurs

#### Scenario: Server length validation
- **WHEN** a request bypasses the browser with empty or over-limit quote text
- **THEN** the server rejects it without storing a message or starting generation

### Requirement: Composer draft restoration
The system SHALL save each composer's unsent draft in the browser, for the current tab session only, keyed by conversation and by composer: the main conversation, an existing thread, or the conversation's single new thread that has not been sent. The draft comprises the message text and the pending attachment: a quote, a checked passage reference, or none. A new-thread draft SHALL also hold its anchor response and anchor quote. The draft SHALL be saved as it changes and when the page is hidden. It SHALL be restored when its composer opens in that tab. A saved draft SHALL be cleared when its message is submitted and when its conversation is deleted from that tab. Saved data that is missing, unreadable, malformed, or from an unknown format version SHALL be discarded silently, and the composer SHALL start empty. If browser storage is unavailable, the composer SHALL keep working without restoration. Notices and the attachment's expanded state SHALL NOT be saved.

On restore:
- A passage reference SHALL be shown at once from its saved snapshot and then checked again against the conversation. If the check fails, the reference SHALL be removed and the matching notice shown. Sending SHALL be unavailable until the check finishes.
- A quote SHALL be restored only if its source assistant message is still in the conversation and is a valid source for that composer.
- A new-thread draft SHALL be restored only if its anchor response is still in the conversation. Otherwise the new thread SHALL NOT be reopened.

Drafts SHALL NOT be sent to the server before submission, and SHALL NOT be shared across tabs or devices.

#### Scenario: Draft survives reload
- **WHEN** the reader types a message and reloads the page
- **THEN** the composer shows the same text

#### Scenario: Navigate away and back
- **WHEN** the reader leaves a conversation with a draft for a passage view and returns in the same tab
- **THEN** the draft and its attachment are restored

#### Scenario: Thread drafts are separate
- **WHEN** the reader types different drafts in the main composer and a thread's composer and reloads
- **THEN** each composer shows its own draft

#### Scenario: New thread survives reload
- **WHEN** the reader opens a new thread, types its first message, and reloads in the same tab
- **THEN** the new thread panel reopens with its anchor quote and the typed message

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

### Requirement: Conversation list preview
Each conversation in a book's list SHALL show its title, a one-line preview of the text of the most recent main-conversation message that has text, whether from the reader or the assistant, and, on one line below the preview, its scope for that book and when it was last active. Thread messages SHALL NOT be used for the preview, but SHALL count as activity when deciding when the conversation was last active and how conversations are ordered. When it was last active SHALL be shown relative to now (such as "3 hours ago" or "yesterday"), with the exact date and time available on hover. When that line does not fit, the scope SHALL be truncated so that when it was last active stays visible. The row SHALL NOT show the conversation's message count. The preview SHALL be plain text, with markdown markup and line breaks removed, and SHALL be truncated to fit one line. Tool activity, citation markers, and attachments SHALL NOT appear in the preview. A conversation with no message text SHALL show that it has no messages yet. The preview SHALL be rendered as text, never as HTML.

#### Scenario: Preview of the latest reply
- **WHEN** a conversation's most recent message is an assistant reply beginning "**Hal** is reading the dictionary because"
- **THEN** its row shows "Hal is reading the dictionary because…" on one line

#### Scenario: Latest activity in a thread
- **WHEN** a conversation's most recent message was sent in a thread
- **THEN** its row is ordered and dated by that message, while its preview shows the latest main-conversation message with text

#### Scenario: Latest message has no text
- **WHEN** a conversation's most recent assistant message failed before producing text
- **THEN** the preview shows the text of the latest earlier message that has text

#### Scenario: Empty conversation
- **WHEN** a conversation has no messages
- **THEN** its row says it has no messages yet

#### Scenario: Markup in a message
- **WHEN** a message's text contains HTML tags
- **THEN** the preview shows them as literal text

#### Scenario: Last active relative to now
- **WHEN** a conversation was last active three hours ago
- **THEN** its row shows "3 hours ago", shows the exact date and time on hover, and does not show its message count

### Requirement: Conversation usage display
The conversation view SHALL show, for each assistant reply that has recorded usage, its token counts (input, cached input, output) and estimated cost in a compact, secondary form that does not interrupt reading. It SHALL also show the conversation's running total of tokens and estimated cost, including attempts that failed and were retried and replies in all of its threads. Totals SHALL update when a reply finishes, without a page reload. Usage figures SHALL be visible to any signed-in reader who can open the conversation and SHALL never include credentials.

#### Scenario: Reply finishes
- **WHEN** a reply finishes streaming
- **THEN** its token counts and estimated cost appear with it, and the conversation total includes them

#### Scenario: Thread reply finishes
- **WHEN** a reply in a thread finishes streaming
- **THEN** the conversation total shown in the main conversation includes it without a page reload

#### Scenario: Stopped reply
- **WHEN** the reader stops a reply partway
- **THEN** the usage shown for it is marked as possibly incomplete

#### Scenario: Reopened conversation
- **WHEN** the reader reopens a conversation later
- **THEN** each reply's usage and the conversation total are shown as they were recorded
