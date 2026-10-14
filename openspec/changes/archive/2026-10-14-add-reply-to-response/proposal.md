## Why

Readers need to follow up on a particular claim in an assistant response without copying it and explaining which part they mean. [Issue #13](https://github.com/masonfox/marginalia/issues/13) asks for a selection action that carries highlighted response text into the next message as context.

## What Changes

- Offer a nearby, accessible “Reply to selection” action for text selected inside one persisted, non-streaming assistant response.
- Attach one removable quote preview to the composer while preserving the reader's draft; a later selection replaces the pending quote.
- Send and persist the quote's source message ID and selected text with the user's message, display it in sent history, and replay it as labeled assistant-response context to the model.
- Limit quotes to 2,000 characters, reject invalid sources, and preserve retry behavior and stable history replay.
- Keep response quotes distinct from verified book evidence; citation verification and reading scope remain unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `literary-conversations`: Add selection-based replies, composer quote lifecycle, persistent quote context, and model replay requirements.

## Impact

- Conversation page (`src/routes/c.$conversationId.tsx`) and assistant rendering (`src/components/chat.tsx`), including selection handling, composer state, user-message rendering, and retries.
- Conversation HTTP validation, chat history preparation/model conversion, schema types and repository loading under `src/modules/conversation`.
- Existing JSON message parts can carry a typed quote data part without a database migration or new dependencies.
- Focused unit, integration, and browser coverage for selection, validation, persistence, retries, and provider context. This change contains planning artifacts only.
