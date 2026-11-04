## Context

The library page (`src/routes/index.tsx`) loads `listEditionsFn`, which calls `listEditions(db)` in `src/modules/library/browse.ts`. That function selects every edition, ordered by `lower(title), created_at`, with no limit. A book's display status is derived there: a ready edition with no available `library_files` row shows as `unavailable` (`availableExpr` and `displayStatus`). The page polls the whole list every 3 seconds while any loaded edition is processing.

Reading state is stored in `reading_positions` (`src/modules/guide/schema.ts`). There is no row when no position is set, `max_position` is null when the book is finished, and otherwise the reader is partway through. The position is shared by the whole instance.

Module boundaries: each module is imported only through its `index.ts`, and this is enforced per module by overrides in `biome.json`. `guide` already imports `library` (`reading_positions.edition_id` references `editions`), and both modules export their schemas from their index. Routes and `fns/` are thin wrappers.

Requirements are in `specs/library-browsing/spec.md`. The target size is up to 5,000 editions.

## Goals / Non-Goals

**Goals:**
- One query owns paging, search, the status filter, and the merged status, so what the card shows and what the filter matches cannot disagree.
- Paging that never repeats or skips a book when imports land mid-scroll.
- Polling cost that grows with the pages loaded, not the library size.

**Non-Goals:**
- Database indexes for search or paging. A sequential scan of 5,000 rows is cheap. Revisit if libraries grow well past that.
- Virtualizing the rendered grid. A few thousand list items with lazy-loaded covers render fine.
- Changing `listEditions`. Its existing callers and tests stay as they are.

## Decisions

### 1. A read-only `shelf` module owns the list query

New module `src/modules/shelf` exports `listShelf(db, { q, status, cursor, limit })`. It returns `{ items, nextCursor, total, matching, needsAttention, processing }`, where each item is `{ id, title, authors, status, error, hasCover }` and `status` is one of `processing | failed | unavailable | not-started | reading | finished`. It imports `editions` and the availability helpers from `#/modules/library`, and `readingPositions` from `#/modules/guide`. It owns no tables. `biome.json` gets a `src/modules/shelf/**` override matching the other modules' boundary rule.

`library/browse.ts` exports `availableExpr` (renamed `editionAvailableSql` or similar for clarity) so `shelf` reuses the availability rule instead of copying it.

*Alternatives:*
- Put the query in `library`. Rejected because `library` would have to import `guide`, which imports `library`, creating a cycle.
- Have `guide` export a SQL fragment that `library`'s list function accepts as an injected filter or column. Rejected because `library` would gain generic extension hooks that exist only for this one query, and the merged-status logic would be split across two modules.
- Put the query in `fns/library.ts`. Rejected because a paged query with search, a merged status, and integration tests is domain logic, and `fns/` stays thin.

### 2. Merged status is computed in SQL

One `CASE` expression, defined once in `shelf`, is used both as a selected column and in the filter:

```
editions.status = 'processing'               -> processing
editions.status = 'failed'                   -> failed
not available                                -> unavailable
no reading_positions row                     -> not-started
reading_positions.max_position is null       -> finished
otherwise                                    -> reading
```

The query `LEFT JOIN`s `reading_positions` on `edition_id`. The filter maps `not-started`, `reading`, and `finished` to equality on the expression, and `attention` to membership in `processing, failed, unavailable`. Defining the status once is what keeps the badge and the filter consistent.

### 3. Keyset paging on the title order

The order is `lower(title), created_at, id`, which extends today's order with `id` as a unique tie-breaker. The cursor is those three values, encoded as an opaque base64url JSON string. The server function validates its shape with zod, and an invalid cursor is rejected as a bad request. The next page is selected with a row comparison `(lower(title), created_at, id) > ($1, $2, $3)`. The page size is 60, which fills several rows of the grid at every breakpoint.

*Alternative:* offset paging. Rejected because a book imported ahead of the reader's position shifts every later offset, so a book would repeat at a page boundary.

### 4. Search is a case-insensitive substring match

The query is trimmed, and an empty query means no search. It matches `title ILIKE '%q%'` or `exists (select 1 from jsonb_array_elements_text(authors) a where a ILIKE '%q%')`. `%`, `_`, and `\` in the input are escaped so they match literally. The query length is capped at 200 characters by validation.

*Alternatives:* `pg_trgm` similarity, which needs an extension and index for fuzzy matching nobody asked for; or full-text search, which stems and tokenizes words, so a partial word typed so far would not match.

### 5. Counts come with every page

Each response carries:
- `total`: the number of editions in the library;
- `matching`: the number that match the current search and filter;
- `needsAttention`: the number of editions that are processing, failed, or unavailable, ignoring the search and filter;
- `processing`: the number of editions that are processing, ignoring the search and filter (drives polling, decision 7).

These are cheap aggregate queries at this size and are run with the page. The UI shows "N books" when no search or filter is active, and "M of N books" otherwise. It offers the Needs attention option when `needsAttention > 0` or when that filter is selected.

### 6. URL state and the client query

The `/` route gets `validateSearch: z.object({ q: z.string().max(200).optional(), status: z.enum([...]).optional() })`. This follows the existing route pattern, as in `books.$editionId.tsx`.

- The search input keeps its own local state. After a 250 ms debounce it navigates with `replace: true`, so typing does not add history entries. The filter navigates with `replace: true` as well.
- `useInfiniteQuery` with the key `["shelf", { q, status }]` and `getNextPageParam: (p) => p.nextCursor`. The loader prefetches the first page with `ensureInfiniteQueryData`, so server rendering and back navigation show the list immediately.
- A sentinel element after the grid uses an `IntersectionObserver` (with a `rootMargin` of about one screen) to call `fetchNextPage` when visible, unless a page is already loading or there is no next page. A visible "Loading more…" state shows while a page loads.
- Going back to the library restores the cached pages from the query cache. TanStack Router's scroll restoration returns the reader to their place. The query key includes `q` and `status`, so each search has its own cache entry.
- The existing invalidations of `["editions"]` (after upload and retry) also invalidate `["shelf"]`.

### 7. Polling follows the library, not the loaded items

The query polls every 3 seconds while the first page's `processing` count is above zero. Polling uses the library-wide count rather than the loaded items, because with a Reading filter no processing book is loaded, yet the counts and the Needs attention option still need to update. React Query refetches each loaded page in sequence, from the first page's cursor onward, so cost grows with pages loaded. Refetched pages recompute their cursors, which keeps paging consistent after imports.

### 8. Empty states

- No editions in the library (`total = 0`): the existing upload guidance.
- Editions exist but none match (`matching = 0`): "No books match", with a button that clears both `q` and `status`.

## Risks / Trade-offs

- [A reader scrolled deep into a large library while an import runs refetches many pages every 3 seconds] → At 60 per page and 5,000 books that is at most about 84 small requests per cycle, only during imports and only for readers who scrolled that far. If this becomes a problem, poll only a status endpoint for the processing IDs that are loaded.
- [`ILIKE '%q%'` scans every row] → This is fine at 5,000 rows. Add a `pg_trgm` GIN index if libraries grow much larger. The query shape does not change.
- [A book whose title changes on reparse moves in the order mid-scroll] → It may be skipped or repeated once in a loaded list, and appears correctly after the next refresh. This is rare and harmless.
- [Reading state is shared by everyone on the instance] → It is documented already (reading-position spec). The filter shows the household's state, not the individual reader's.
- [`ensureInfiniteQueryData` and the router's scroll restoration may interact badly with the sentinel firing on restore] → The sentinel only fetches when it is truly visible, and `hasNextPage` guards it. This is covered by an e2e check of returning from a book.

## Migration Plan

There are no schema changes. The release ships with the new page. `listEditionsFn` stays available, and can be removed later if nothing else uses it.
