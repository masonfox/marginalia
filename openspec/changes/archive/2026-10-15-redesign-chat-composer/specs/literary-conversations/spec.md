## MODIFIED Requirements

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

## ADDED Requirements

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
