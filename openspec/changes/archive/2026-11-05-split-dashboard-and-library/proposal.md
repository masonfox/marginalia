## Why

The page at `/` is titled Dashboard but is really the library with a Continue section on top: "what am I in the middle of" and "everything I own" share one page, and the search, filters, and infinite grid crowd out the part a reader opens the app for. Splitting them gives each a clear job: the dashboard shows what you are reading and talking about, and a dedicated Library page holds the full catalog.

## What Changes

- **Dashboard becomes a short "in progress" view.** `/` keeps the Continue section (three most recent conversations, "See all conversations") and adds a **Reading** section: books in the Reading state (ready, with a reading position that is not finished), most recently updated position first, one row (up to four, two on phones), each showing its cover, title, authors, and position ("Through Chapter 3"), with a link to see all books being read. The dashboard no longer shows the book count, search, status filter, full grid, Upload, or Rescan.
- **Dashboard empty states.** With no books, the dashboard says there are no books yet and links to the Library to upload one. With books but nothing to continue or read, it points to the Library.
- **New Library page at `/library`.** The current library list moves there unchanged: count, Upload, Rescan, search, status filter (including Needs attention), infinite scroll, and import status updates. Deleting a book returns to the Library.
- **Old library URLs redirect.** `/` with a `q` or `status` search redirects to `/library` with the same search and filter. **BREAKING** for anyone relying on the library list living at `/`; bookmarks keep working through the redirect.
- **Three-entry navigation.** The header navigation becomes Dashboard, Library, Conversations.
- **Phone header becomes one row with a menu.** On narrow viewports the header holds the app name, the icon-only New conversation control, and a "Menu" button. The menu lists Dashboard, Library, and Conversations (current page marked), then Settings and, when a password is set, Log out. The second navigation row is removed. Wider viewports are unchanged apart from the third entry.
- **Clearer conversation rows.** Rows in lists across books start with a small stack of the conversation's book covers. Every conversation row shows its title, its preview, and one quiet line with its books or scope and a relative last-active time (exact time on hover); the message count is no longer shown.

Non-goals: surfacing failed or processing imports on the dashboard (they stay under the Library's Needs attention filter); actions on Reading cards beyond opening the book; tracking actual reading activity (the shelf orders by when the position was last changed); changing the conversations page; a setting for which page opens first.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `library-browsing`: The library list, search, filter, and empty state move to a Library page at `/library`; the dashboard at `/` holds Continue and a new Reading section; old `/` search URLs redirect; the header navigation gains a Library entry; deleting a book returns to the Library.
- `responsive-layout`: On narrow viewports the app header becomes one row whose navigation, Settings, and Log out are in a menu, replacing the second navigation row.
- `literary-conversations`: Conversation rows drop the message count, show when they were last active relative to now, and, in lists across books, show a stack of the books' covers.

## Impact

- **Server** (`src/modules/shelf`, `src/fns/library.ts`): a query for the Reading shelf, limited and ordered by reading position `updated_at`, returning each book's position label; a server function exposing it.
- **Routes**: `src/routes/index.tsx` becomes the dashboard; a new `src/routes/library.tsx` takes the current library page; `/` redirects `q`/`status` searches; `books.$editionId.about.tsx` navigates to `/library` after deletion.
- **Header** (`src/routes/__root.tsx`, `src/components/home-nav.tsx`): a third nav entry and a phone menu built on the existing `dropdown-menu` primitive.
- **Tests**: integration tests for the Reading shelf query, component tests for the phone menu, and updated e2e flows (library at `/library`, back to a filtered library, navigation on a phone).
- **Builds on** the archived `add-conversations-home` and `start-multi-book-conversations` changes, whose navigation and compact-header requirements this replaces.
