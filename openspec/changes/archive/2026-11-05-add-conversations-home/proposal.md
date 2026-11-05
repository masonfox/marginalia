## Why

Conversations can only be found from the book they are filed under: the book page's Discuss tab lists that book's conversations and nothing else (issue #38). Picking up a thread means remembering which book it belongs to, and a conversation about several books has no single home. On a phone, "continue where I left off" is the most common reason to open the app, and the library page does not offer it.

## What Changes

- **Continue on the library.** The library page opens with a short "Continue" list of the most recently active conversations across all books, with a link to see all of them. It is hidden when there are no conversations, and does not change the library list, search, or filter below it.
- **Conversations page.** A new `/conversations` page lists every conversation, most recently active first, loading more as the reader scrolls. Each row shows the title, its book or books with scope, message count, last active time, and the last-message preview the book page already uses, with the same rename and delete actions.
- **Dashboard / Conversations navigation in the header.** The page at `/` (Continue plus the library list) is titled Dashboard. The app header holds a two-item navigation, Dashboard and Conversations, on every page except login: beside the app name on wider screens, on its own row below it on phones. The book page drops its own back link. The library list stays at `/`, so existing links (including `?q=` and `?status=`) keep working.
- **Multi-book labels.** A conversation with one book shows its title and scope. With two books, both titles. With three or more, the first title and "+N". Every book and its scope is in the row's accessible name.

Non-goals: a setting for which page opens first (the library always does); a global "start a conversation" action and starting conversations about several books (change `start-multi-book-conversations`); searching or filtering conversations; conversation counts on library cards; changing the book page's conversation list.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `literary-conversations`: Conversations can be listed across all books, not only per book, and rows label conversations about several books.
- `library-browsing`: The library page, now titled Dashboard, shows recently active conversations and links to the conversations page, and the app header navigates between the two.
- `responsive-layout`: On phones the app header takes a second row for the navigation.

## Impact

- **Server** (`src/modules/conversation/repository.ts`, `src/fns/conversations.ts`): a paged query over all conversations, most recently active first, returning each conversation's books with their scopes and the existing preview. A new server function exposes it.
- **Database**: an index on `conversations (updated_at, created_at, id)` for the ordering; one migration, no data changes.
- **UI**: a new `src/routes/conversations.tsx`, a Continue section on `src/routes/index.tsx`, the navigation in the app header (`src/routes/__root.tsx`), and a list row in `conversation-list.tsx` that can show several books.
- **Tests**: integration tests for the query (ordering, paging, multi-book books, previews), unit tests for the book label, and an e2e flow from the library's Continue list.
- **Builds on** the archived `rework-book-page`: the deltas build on its conversation list and responsive-layout requirements.
