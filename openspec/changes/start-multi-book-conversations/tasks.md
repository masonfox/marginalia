## 1. Server

- [ ] 1.1 Add `MAX_CONVERSATION_BOOKS` and `createConversationForEditions` (id-ordered `for share` locks, per-book scope resolution, reader order as `ordinal`, first failing book reported); verify with integration tests for two books, a missing book, a not-ready book, a stale scope on the second book, and duplicate ids
- [ ] 1.2 Change `createConversationFn` to `{ books: [{ editionId, scope }], selection? }` with 1..3 distinct books and the new error shapes; verify a four-book request is rejected and `pnpm typecheck` passes
- [ ] 1.3 Update the passage dialog and the book composer to the list form; verify their existing tests pass

## 2. Composer

- [ ] 2.1 Generalize `BookComposer` to a list of books, each with its own scope strip and reading position; verify with component tests that changing one book's scope leaves the other's unchanged
- [ ] 2.2 Queue scope sheets on send for books without a position, creating nothing on dismissal; verify the one-position-missing and dismiss scenarios in component tests
- [ ] 2.3 Add book chips with remove (not for the only book on the book page) and the "Add book" picker on the shelf query, hiding non-ready and chosen books, hidden at 3 books; verify with component tests and keyboard operation
- [ ] 2.4 Store chosen book ids with drafts and add `newConversationDraftId`; verify reopening restores books and text, and dropped books are ignored

## 3. Header and conversation view

- [ ] 3.1 Add the New conversation control and dialog to `__root.tsx` (hidden on login, icon-only on narrow screens, AI setup notice when unavailable); verify the header fits one row at 360px
- [ ] 3.2 Render the mixed spoiler notice and send multi-book back links to the conversations page; verify with unit tests for whole, bounded, and mixed books

## 4. Verification

- [ ] 4.1 Add an e2e flow: from the library header start a conversation about two books, check both Discuss tabs list it, and check the mixed notice; verify `pnpm test:e2e` passes
- [ ] 4.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; verify all pass
