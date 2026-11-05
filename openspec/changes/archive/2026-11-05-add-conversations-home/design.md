## Context

See proposal.md for motivation. Today the only conversation listing is `listConversationsForEdition`, which joins `conversation_editions` on one edition and returns that book's `scopeLabel` and a last-message preview (a lateral subquery over `messages`). The library list (`src/modules/shelf`, `src/routes/index.tsx`) already pages with an opaque keyset cursor (`src/lib/shelf-cursor.ts`) and an intersection-observer sentinel. `conversations` has no index on `updated_at`. The data model already allows several books per conversation; only one-book conversations can be created from the UI today.

## Goals / Non-Goals

**Goals:**
- One query that serves both the Continue section (first 3) and the conversations page (paged).
- Reuse the existing preview logic and row component so the book page, Continue, and conversations page stay consistent.

**Non-Goals:**
- Live updates of the list while it is open (no polling; it refreshes on navigation and after rename or delete).
- Showing a conversation exactly once *and* never missing one while activity reorders the list. See Risks.

## Decisions

### D1. A new repository query, `listRecentConversations`, beside the per-edition one
It takes `{ cursor?, limit }` and returns `{ items, nextCursor }`. Each item has the `ConversationSummary` fields without `scopeLabel`, plus `books: { editionId, title, scopeLabel }[]` in `ordinal` order, built with a correlated `json_agg` subquery over `conversation_editions` joined to `editions`. The preview reuses the same lateral subquery and `previewText` as `listConversationsForEdition`, moved into a shared helper so the two cannot drift.

*Alternative:* generalize `listConversationsForEdition` with an optional edition filter. Rejected: the per-edition result has one scope per row, the global one has a list of books, and mixing them would change the book page's type for no gain.

### D2. Keyset paging on `(updated_at desc, created_at desc, id desc)`
The cursor encodes the last row's three values, as base64url JSON validated with zod in a client-safe `src/lib/conversation-cursor.ts`, following `shelf-cursor.ts` (microsecond timestamps as strings so the comparison is exact). Page size is 30. A migration adds an index on `conversations (updated_at desc, created_at desc, id desc)`.

*Alternative:* offset paging. Rejected: a new message moves a conversation to the top and shifts every offset, so rows repeat across pages.

### D3. Duplicates are prevented by the keyset and by de-duplicating by id on the client
With a keyset, a conversation that moves to the top after it was shown is newer than the cursor and is not returned again. The client also drops ids it has already rendered when flattening pages, which covers a refetch of earlier pages racing a later one.

### D4. The Continue section is the first page with `limit: 3`
The library loader prefetches `listRecentConversationsFn({ limit: 3 })` alongside the shelf query, under its own query key (`["conversations", "recent", 3]`). It does not depend on the shelf's search params, so typing in the search box does not refetch it. Rename and delete invalidate the `["conversations"]` prefix as well as the router, so the Continue section, the conversations page, and the book page refresh together.

### D5. One row component with a book label
`ConversationRow` moves out of `ConversationList` so all three lists use it. It takes a `bookLabel` mode: on the book page the row keeps showing that book's scope only, while on Continue and the conversations page it shows the label from a pure `conversationBooksLabel(books)` helper (one book: title and `scopeText`; two: both titles; three or more: first title "+N"), and the accessible name lists every title with its scope. The helper is unit tested.

### D6. Navigation lives in the app header, on its own row on phones
A `HomeNav` with two `Link`s (Dashboard `/`, Conversations `/conversations`) is rendered by `__root.tsx` on every page except login, using `aria-current="page"` from the router's active state, so on book and conversation pages neither entry is current. The header row is `flex-wrap`: on wider screens the nav sits beside the app name and the icon controls are pushed right; below `sm` the nav is `order-last basis-full`, taking a second row. Entries are filled pills rather than underlined tabs, so the current state reads the same in both layouts. The book page's "← Dashboard" link is removed as redundant; the conversation page keeps its link to the book. The Dashboard link has no search params; the browser's back action restores the filtered library, as the URL holds the search and filter.

*Alternative:* nav at the top of the two pages only. Tried first and rejected after use: switching from a book or a conversation took two steps, and the header is where readers look for it.

*Alternative:* one header row on phones with icon-only tabs, or with the app name hidden. Rejected: icon tabs are easy to misread, and with the name hidden the row has no room for the New conversation control that `start-multi-book-conversations` adds.

## Risks / Trade-offs

- [A conversation not yet loaded that receives a message while the reader scrolls moves above the cursor and is skipped until the list is reloaded] → Acceptable for a personal library; the spec only promises no duplicates. Reopening the page shows it first.
- [The `json_agg` of books per row costs one subquery per conversation] → Bounded by the page size (30) and the indexed `conversation_editions` primary key.
- [The book page list and the new lists share a row, so a change for one affects the others] → The `bookLabel` mode is explicit, and the existing book page tests keep covering its rendering.

## Migration Plan

One additive index migration (`drizzle-kit generate`). No data changes. Rollback is dropping the index and the new route.
