## 1. Shelf module and query

- [x] 1.1 Export the availability expression (and `displayStatus` if reused) from `src/modules/library/browse.ts` through the library index, without changing `listEditions`. Verify that `pnpm typecheck` passes and the existing library integration tests still pass.
- [x] 1.2 Create `src/modules/shelf` (`index.ts` plus the query file) and add its `biome.json` boundary override, following the other modules. Verify that `pnpm lint` passes and that a deliberate deep import from `shelf` into `#/modules/guide/schema` is rejected (then removed).
- [x] 1.3 Implement the merged status `CASE` expression and `listShelf(db, { q, status, cursor, limit })` with the `reading_positions` left join, the status filter, and the `(lower(title), created_at, id)` keyset with an opaque cursor (design decisions 2–3). Verify with a `shelf.int.test.ts` covering each of the six statuses, including a ready book that has a position but no available file showing `unavailable`.
- [x] 1.4 Add the title and author search with trimming and escaped `%`, `_`, and `\` (design decision 4). Verify with integration tests for a title match, a match on the second author, case-insensitivity, a literal `%` in the query, and search combined with each filter.
- [x] 1.5 Return `total`, `matching`, `needsAttention`, and `processing` with every page (design decision 5). Verify with an integration test asserting the counts under a search plus a filter, and that `needsAttention` and `processing` ignore both.
- [x] 1.6 Verify paging with integration tests: walking all pages of about 130 editions, including duplicate titles, returns each exactly once in order; inserting an edition that sorts before the cursor between page fetches causes no repeat; and an invalid cursor is rejected.

## 2. Server function

- [x] 2.1 Add `listShelfFn` to `src/fns/library.ts` with zod validation (`q` ≤ 200 chars, `status` enum, optional cursor string) that delegates to `listShelf` with a page size of 60. Verify that `pnpm typecheck` passes and that a malformed cursor or overlong query returns a validation error.

## 3. Library page

- [ ] 3.1 Add `validateSearch` for `q` and `status` to the `/` route, and replace the `editionsQuery` with an infinite query keyed by `["shelf", { q, status }]` that the loader prefetches with `ensureInfiniteQueryData`. Verify that opening `/?q=woolf&status=finished` server-renders the filtered first page.
- [ ] 3.2 Render the single status badge per card: Processing, Failed with its reason and Retry, Unavailable, Not started, Reading, and Finished, with no "Ready". Verify visually with a dev library containing each state, and with a component test of the status-to-label mapping.
- [ ] 3.3 Add the debounced search input and the status filter, both updating the URL with `replace: true`. Show Needs attention only when `needsAttention > 0` or it is selected. Verify that typing does not add history entries, that reload keeps both values, and that the option disappears once nothing needs attention.
- [ ] 3.4 Add the infinite-scroll sentinel (`IntersectionObserver`, `rootMargin` of about one screen, guarded by `hasNextPage` and `isFetchingNextPage`) and a "Loading more…" state. Verify against a dev library of at least 200 books that scrolling loads every book once and then stops.
- [ ] 3.5 Show "N books" or "M of N books" from the response counts. Show the "No books match" empty state with a clear-search-and-filter action when `matching = 0` and `total > 0`, and keep the upload guidance for `total = 0`. Verify each state in the dev library.
- [ ] 3.6 Poll every 3 seconds while `processing > 0` from the first page, and make upload and retry invalidate `["shelf"]` alongside `["editions"]`. Verify that uploading a book with a Reading filter active stops polling once import finishes, and that a failed import appears under Needs attention without a reload.

## 4. End-to-end and docs

- [ ] 4.1 Add Playwright checks in `e2e/app.spec.ts`: search narrows the list and survives reload; the status filter shows only matching books; scrolling, opening a book, and going back restores the same filter and loaded books. Verify that `pnpm test:e2e` passes.
- [ ] 4.2 Update the README feature list to mention library search, status filtering, and reading-state badges. Verify by reading the rendered README.
- [ ] 4.3 Run `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, and `pnpm test:integration`, and verify that all pass.
