## Why

A reader looking at a passage in the passage view (`/p/<locator>`) has no direct way to discuss it. They have to start a conversation and describe or retype the passage, and the assistant then has to search for it. [Issue #14](https://github.com/masonfox/marginalia/issues/14) asks for a link option on the passage view that the chat view understands, so a specific passage can start or steer a conversation.

## What Changes

- Add passage reference actions to the passage view: per passage block, and for a text selection within one passage. Each action offers "Copy link", "Discuss in a new conversation", and "Add to an existing conversation" for that book.
- Use the passage view URL itself (`/p/<locator>`, with an optional `?hl=start-end` range) as the reference format, so copied links still open the passage in a browser.
- Recognise a pasted passage link from this instance in the chat composer and attach it as a passage reference instead of inserting the URL text.
- Show a pending passage reference in the composer as a removable preview: book, section, and passage text with the selected range marked. The composer holds at most one attachment, so a passage reference and a reply quote replace each other.
- Validate passage references on the server before storing or generating. A reference is rejected if it cannot be resolved, belongs to a book outside the conversation, or has an invalid range. A reference to text beyond the conversation's reading scope is rejected with a dedicated out-of-scope result, and the conversation view offers the existing Widen scope control.
- Store a server-resolved snapshot of the referenced passage with the user message, display it in history as verified book text linking back to the passage view, and replay it to the model as a labelled, reader-referenced passage with its locator so the model can cite it.
- When the reader starts a new conversation from a passage, the scope dialog offers only reading units that include the passage, plus "whole book". Nothing is preselected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `library-browsing`: The passage view gains passage and selection reference actions (copy link, discuss in a new conversation, add to an existing conversation).
- `literary-conversations`: Pasted passage link recognition, pending passage reference lifecycle, server validation including the scope check, persistent display, and model replay.
- `reading-scope`: Starting a conversation from a passage limits the scope choices to units that include that passage.

## Impact

- Passage view (`src/routes/p.$locator.tsx`): per-passage actions, selection capture with character offsets into the passage text, and a conversation picker.
- Conversation page (`src/routes/c.$conversationId.tsx`): handling of pasted links and incoming reference search params, composer attachment state, rendering of user messages, and retry/edit recovery that carries the reference.
- Scope dialog (`src/components/scope.tsx`): an optional passage constraint on the unit choices.
- Server: chat HTTP validation and `startChat` (`src/modules/conversation`), a new attach-time check server function, and history projection for the model. These reuse `resolveLocator` and the existing book-bound visibility rule (`revealPosition <= maxPosition`).
- A new client-safe module for parsing and building passage links and the passage-context message part. Existing JSON message parts carry it, so no migration or new dependencies are needed.
- Unit, integration, and Playwright coverage. The system prompt and tool definitions stay unchanged, so the stable request prefix is preserved.
