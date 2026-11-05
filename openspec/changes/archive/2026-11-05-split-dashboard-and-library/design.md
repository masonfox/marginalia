## Context

See proposal.md for motivation. Today `src/routes/index.tsx` is the whole library page: it validates `q`/`status` search params, prefetches the shelf (`listShelfFn`, keyset-paged in title order) and the Continue query (`listRecentConversationsFn({ limit: 3 })`), and renders the count, Upload, Rescan, search, filter, and infinite grid. The shelf's status is a SQL `case` (`statusSql` in `src/modules/shelf/list.ts`) over `editions` and a left join to `reading_positions`, which has `max_position`, `scope_label`, and `updated_at`. The header (`__root.tsx`) renders `HomeNav` (two `Link`s with `aria-current`) and, below `sm`, wraps it onto a second row. A Radix-based `dropdown-menu` primitive already exists in `src/components/ui`.

## Goals / Non-Goals

**Goals:**
- Move the library page to `/library` with no behavior change beyond its URL.
- One small query for the Reading section that reuses the shelf's status definition, so the section and the Library's Reading filter cannot disagree.
- Replace the phone's second header row with a menu, without changing the desktop header beyond a third entry.

**Non-Goals:**
- Paging or scrolling within the Reading section (it is capped; the link goes to the filtered Library).
- Polling the dashboard for import status. The Library keeps its polling; the Reading section only changes when the reader sets a position, which happens on another page.

## Decisions

### D1. Move the page file; the root route becomes the dashboard
`src/routes/index.tsx` moves to `src/routes/library.tsx` (route `/library`) with its search schema, loader, and components intact, title changed to "Library". A new `index.tsx` renders the dashboard. Shared pieces the dashboard also needs (`Cover`, the Continue query options) move to small modules (`src/components/book-cover.tsx`, and the Continue query beside the conversations fns or in a `src/lib` query-options file) instead of being imported across route files.

*Alternative:* keep the library at `/` and put the dashboard elsewhere. Rejected: the dashboard is what the app name and the default landing should open.

### D2. Redirect old root URLs in `beforeLoad`
The root route keeps a permissive `validateSearch` for `q` and `status` (same `catch` fallbacks). `beforeLoad` throws `redirect({ to: "/library", search: { q, status }, replace: true })` when either is present, so the root URL does not stay in history. A root URL without them renders the dashboard.

### D3. `listReadingShelf(db, { limit })` in the shelf module
A second export from `src/modules/shelf/list.ts`, reusing `statusSql` and the same join: `where statusSql = 'reading'`, `order by reading_positions.updated_at desc, editions.id`, `limit` (capped at 4 by the server function). It returns `{ items: { id, title, authors, hasCover, scopeLabel }[], total }`, where `total` is the library's edition count, which the dashboard needs to choose between the "no books yet" and "nothing in progress" states without a second request. A `listReadingShelfFn` in `src/fns/library.ts` exposes it with a fixed limit of 4.

*Alternative:* add a `sort` option to `listShelf`. Rejected: its keyset cursor encodes title order, and a recency sort would need a second cursor shape for a list that never pages.

### D4. Phones show two cards by hiding the rest with CSS
The dashboard always fetches four. The grid is two columns below `sm` and four above, and items after the second get `max-sm:hidden`. This avoids a viewport-dependent query and keeps SSR and hydration identical.

### D5. Dashboard data and empty states
The loader prefetches `listReadingShelfFn` and the Continue query in parallel; a Continue failure is caught as today so it never fails the page. The page renders: Continue (if any), Reading (if any), else, when `total === 0`, the "No books yet" empty state with a link to `/library` (where Upload is), else a short line linking to the Library. Rename and delete in Continue keep invalidating the `["conversations"]` prefix. Upload, retry, and delete invalidate a new `["reading-shelf"]` key alongside `["shelf"]`, and the dashboard query refetches on mount, so a position changed on a book page shows up on return.

### D6. Navigation: a three-entry `HomeNav`, and a `HeaderMenu` below `sm`
`HomeNav` gains a Library entry (`to="/library"`, `activeOptions: { includeSearch: false }`), with Dashboard still `exact`. On wider viewports the header is as today plus that entry. Below `sm`, `HomeNav`, the Settings link, and the Log out form are hidden (`max-sm:hidden`), and a `HeaderMenu` is shown (`sm:hidden`): a `DropdownMenu` whose trigger is an icon button named "Menu", with `DropdownMenuItem asChild` wrapping the three router `Link`s (current one marked with `aria-current="page"` and the pill style), a separator, Settings, and, when auth is enabled, Log out. Radix provides `aria-expanded`, keyboard navigation, Escape and outside-click dismissal, and focus return. Selecting a `Link` item closes the menu on select.

Log out is a `POST /logout` form today. In the menu, the item submits a hidden form via `requestSubmit()` on select, so logout stays a POST.

*Alternative:* a sheet/drawer for the menu. Rejected: six items fit a dropdown, and no drawer primitive exists in the project.

*Alternative:* render one nav and restyle it into a menu with CSS. Rejected: a disclosure menu needs a trigger and focus management that a styled list does not provide.

### D7. Delete navigates to `/library`
`books.$editionId.about.tsx` navigates to `/library` after deletion (and when the book was already gone). Deleting a conversation from its page keeps navigating to `/`, now the dashboard.

## Risks / Trade-offs

- [Reading order follows when the position was last changed, not when the reader last read] → Accepted in the proposal; it is the only per-book recency signal stored. Revisit if a "last opened" timestamp is added.
- [Two DOM copies of the navigation (inline and in the menu) could drift] → Both are built from one list of entries in `home-nav.tsx`; tests assert both render the same three entries.
- [Cards hidden on phones could still be announced by screen readers] → `max-sm:hidden` sets `display:none`, which also removes them from the accessibility tree; a test at 360px checks that only two are exposed.
- [E2E tests and docs that open `/` expecting the library list break] → Update them to `/library` in the same change; the redirect covers external bookmarks with search params, but a bare `/` bookmark now opens the dashboard by design.

## Migration Plan

No database changes. Deploy as one release. Rollback is reverting the route move; `/library` links would then 404, so roll back together with any links added elsewhere.
