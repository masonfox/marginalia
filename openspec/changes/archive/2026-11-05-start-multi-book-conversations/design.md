## Context

See proposal.md for motivation. Storage, retrieval tools, citations, the system prompt, and the conversation view already handle several books (`conversation_editions` with `ordinal`, `maxPosition`, `scopeLabel`). What is single-book: `createConversationForEdition` (one edition, `for share` lock against reparse), `createConversationFn` (`editionId` + `scope`), `BookComposer` (one `ScopeStrip`, drafts keyed by `bookDraftId(editionId)`), and the conversation view's back link (`books[0]`). The shelf query (`listShelfFn`) already searches by title and author with paging.

## Goals / Non-Goals

**Goals:**
- One composer for the book page and the header dialog, differing only in the books it starts with.
- Creation is atomic across all books and safe against concurrent reparses.

**Non-Goals:**
- Changing books on an existing conversation.
- Multi-book starts from the passage dialog.

## Decisions

### D1. `createConversationFn` takes a list of books
Input becomes `{ books: { editionId, scope }[] (1..3, distinct), selection? }`. The single-book form is removed and its callers (book composer, passage dialog) pass a one-item list. Results: `{ id }`, `{ error: "not_ready", editionId }`, `{ error: "stale_scope", editionId }`, or `{ error: "model_unavailable" }`. The cap lives in one constant, `MAX_CONVERSATION_BOOKS = 3`, shared by the validator and the UI.

*Alternative:* keep `editionId` and add an optional `editionIds`. Rejected: two shapes for one operation, and the passage dialog would stay on a different path.

### D2. Lock every edition in id order inside one transaction
`createConversationForEditions` selects all editions `where id in (...) order by id for share`, then resolves each scope, then inserts with `ordinal` from the reader's order. Sorting the lock order by id prevents a deadlock between two creations, or a creation and a reparse, touching the same books in different orders. The first failing book, in the reader's order, is reported.

### D3. Composer state is a list of `{ editionId, title, scope override }`
`BookComposer` becomes `Composer({ initialBooks, draftId })`. Each book row renders the existing `ScopeStrip` with its own `useReadingPosition`, so the per-book behavior (default from position, save or "only this conversation", move-back confirmation) is the existing code applied N times. On send, books whose strip is `unset` are queued and the existing scope sheet opens for each in order; a dismissal clears the queue and leaves state untouched.

### D4. Drafts
The book page keeps `bookDraftId(editionId)` for its text. The header dialog uses a fixed `newConversationDraftId`. Both drafts store the chosen book ids with the text so reopening restores them. Books that are no longer ready when the draft loads are dropped silently.

### D5. Book picker reuses the shelf query
The picker calls `listShelfFn` with the typed query and filters out non-ready books and those already chosen on the client. Filtering on the client keeps the shelf API unchanged. Pages that contain only filtered-out books trigger the next page through the same sentinel.

*Alternative:* add a `readyOnly` option to `listShelf`. Rejected for now: the extra page loads are rare at this library size; it can be added if it shows up.

### D6. Header control and dialog
`__root.tsx` renders a "New conversation" button before Settings (hidden on `/login`) that opens a `Dialog` hosting the composer with `initialBooks: []`. The dialog's AI status comes from `getAiStatusFn`, fetched when it opens.

### D7. Mixed spoiler notice
`ScopeNotice` groups books by whole versus bounded and renders the mixed sentence when both groups are non-empty. The conversation view's back link goes to the conversations page when the conversation has more than one book.

## Risks / Trade-offs

- [Each extra book adds retrieval results and prompt tokens to every turn] → Cap at 3; tool result caps already apply per call.
- [Per-book scope sheets one after another can feel long] → Only books without a position open a sheet; with positions set, sending is one step.
- [The passage dialog changes its call shape] → Covered by its existing tests, updated to the list form.

## Migration Plan

No data migration. The server function's input shape changes together with all its callers in one release.
