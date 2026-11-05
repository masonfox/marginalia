## 1. Server

- [x] 1.1 Add `listReadingShelf(db, { limit })` to `src/modules/shelf/list.ts`, reusing `statusSql` and the reading position join, ordered by `reading_positions.updated_at desc, editions.id`, returning `{ items: { id, title, authors, hasCover, scopeLabel }[], total }`; verify with integration tests in `shelf.int.test.ts` for recency order, the limit, `total`, and exclusion of not started, finished, unavailable, processing, and failed books
- [x] 1.2 Export it from the shelf module and add `listReadingShelfFn` in `src/fns/library.ts` with a fixed limit of 4; verify `pnpm typecheck` passes

## 2. Library page

- [x] 2.1 Move shared pieces out of `src/routes/index.tsx`: `Cover` to `src/components/book-cover.tsx` and the Continue query options to a shared module; verify `pnpm typecheck` passes and the current page renders unchanged
- [x] 2.2 Move the library page to `src/routes/library.tsx` (route `/library`, title "Library") with its search schema, loader, polling, Upload, Rescan, search, filter, and infinite scroll; verify the existing library e2e tests pass after pointing them at `/library`
- [x] 2.3 Make upload, retry, and book deletion also invalidate `["reading-shelf"]`, and navigate to `/library` after deleting a book (including the already-deleted case); verify the deletion e2e test lands on the Library without the book

## 3. Dashboard

- [x] 3.1 Replace `src/routes/index.tsx` with the dashboard: keep a permissive `q`/`status` search schema and redirect to `/library` with the same search (replacing history) in `beforeLoad` when either is present; verify an e2e test that `/?q=woolf&status=finished` opens the Library with both applied and back does not return to `/`
- [x] 3.2 Render the Continue section (three conversations, "See all conversations", hidden when empty, failure does not fail the page) on the dashboard; verify rename and delete from it update without a reload
- [x] 3.3 Add the Reading section: prefetch `listReadingShelfFn`, cards with cover, title, authors, and "Through <label>" linking to the book, two columns below `sm` and four above with items after the second hidden below `sm`, and a link to `/library?status=reading`; verify with an e2e test for order, the card label, the link, and two cards exposed at 360px
- [x] 3.4 Add the empty states: "No books yet" with a link to the Library when `total` is 0, and a link to the Library when there are books but nothing to continue or read; verify both with component or e2e tests

## 4. Header navigation

- [x] 4.1 Add the Library entry to `HomeNav` from a single shared list of entries (Library current whatever its search, Dashboard exact); verify component tests for `aria-current` on each of the three pages and on a book page
- [x] 4.2 Add `HeaderMenu` below `sm` on the `dropdown-menu` primitive: trigger named "Menu", the three entries with the current one marked, a separator, Settings, and Log out (submitting the POST form) when auth is enabled; hide the inline nav, Settings, and Log out below `sm`; verify component tests for entries, current marking, Log out only with auth, and Escape returning focus to the trigger
- [x] 4.3 Update the phone e2e/layout checks: at 360px the header is one row with New conversation and Menu, the menu navigates to Library and closes, and at 1280px all three entries show with no Menu button; verify `pnpm test:e2e` passes

## 5. Verification

- [x] 5.1 Update remaining e2e tests and docs that open `/` expecting the library list (search, filter, scroll and back, upload) to use `/library`; verify `pnpm test:e2e` passes
- [x] 5.2 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; verify all pass
