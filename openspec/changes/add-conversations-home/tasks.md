## 1. Server

- [x] 1.1 Add the `conversations (updated_at desc, created_at desc, id desc)` index to the schema and generate its migration with `pnpm db:generate`; verify the migration applies with `pnpm db:migrate` on the dev database
- [x] 1.2 Add the client-safe `src/lib/conversation-cursor.ts` (encode, decode, validate) following `shelf-cursor.ts`; verify with unit tests for round trips and rejection of malformed cursors
- [x] 1.3 Move the preview subquery and `previewText` handling into a shared helper used by `listConversationsForEdition`; verify the existing conversation integration tests still pass
- [x] 1.4 Add `listRecentConversations(db, { cursor, limit })` returning items with ordered `books` and the preview, plus `nextCursor`; verify with integration tests for ordering (updated, then created), paging to the end, no duplicates when a shown conversation is updated between pages, multi-book `books` order and scopes, and previews
- [x] 1.5 Export it from the conversation module and add `listRecentConversationsFn` (validated cursor and limit, capped) in `src/fns/conversations.ts`; verify `pnpm typecheck` passes

## 2. Shared UI

- [ ] 2.1 Add `conversationBooksLabel(books)` and the accessible-name text; verify with unit tests for one, two, and three books, whole-book and bounded scopes
- [ ] 2.2 Extract `ConversationRow` from `ConversationList` with a book-label mode, keeping the book page's rendering unchanged; verify the book page shows the same rows as before (existing tests and a manual check)
- [ ] 2.3 Make rename and delete invalidate the `["conversations"]` query prefix as well as the router; verify renaming from any list updates the others without a reload
- [ ] 2.4 Add `HomeNav` (Library, Conversations) with `aria-current` and touch-sized targets; verify it fits one row at 360px

## 3. Pages

- [ ] 3.1 Add `src/routes/conversations.tsx`: loader prefetch, infinite scroll with the sentinel, id de-duplication, empty state, and `HomeNav`; verify by scrolling a seeded list of more than 30 conversations
- [ ] 3.2 Add the Continue section and `HomeNav` to the library page, prefetched in the loader and independent of search and filter, hidden when there are no conversations; verify with and without conversations and while searching

## 4. Verification

- [ ] 4.1 Add an e2e flow: start a conversation from a book, return to the library, continue it from the Continue section, then open Conversations and back to a filtered library; verify `pnpm test:e2e` passes
- [ ] 4.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; verify all pass
