## Why

Conversations are stored with a set of books, and retrieval, citations, scope notices, and the conversation view already handle several, but the UI can only start a conversation about one book, and only from that book's page. Comparing two novels, or asking a question before deciding which book it belongs to, needs a way to start a conversation from anywhere and about more than one book.

## What Changes

- **New conversation from the header.** The app header gets a "New conversation" control on the right, next to Settings, on every page except login. It opens the composer in a dialog with no books chosen yet.
- **Books in the composer.** The composer shows the conversation's books as chips above the message input, each with its own scope. "Add book" opens a searchable picker of ready books. A conversation holds 1 to 3 books. The book page's Discuss composer is the same composer with that book already added, and can add others.
- **A scope for each book.** Each chip's scope defaults to that book's reading position and can be changed for that book, either by saving its reading position or for this conversation only, as on the book page today. Sending with any book that has no position asks how far the reader has read in each such book before creating anything.
- **Lift the one-book limit.** Conversations started from the UI may contain up to 3 books. Creation checks every book is ready and every scope is current, all at once.
- **Mixed spoiler notice.** A conversation with some bounded and some whole-book books says which books the assistant can read in full and which only through their scope.

Non-goals: adding or removing books from an existing conversation; multi-book starts from a passage reference (the passage dialog stays one-book); more than 3 books; changes to the conversations list (change `add-conversations-home`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `literary-conversations`: Conversations started from the UI may hold up to 3 books, and the spoiler notice covers conversations with both bounded and whole-book books.
- `reading-scope`: The composer holds a scope per book, each defaulting to that book's reading position.
- `library-browsing`: A conversation can be started from the app header, and the composer lets the reader choose the conversation's books.
- `responsive-layout`: The compact app header includes the New conversation control.

## Impact

- **Server**: `createConversationFn` accepts `books: { editionId, scope }[]` (1 to 3); the repository locks every edition in id order, resolves each scope, and reports which book is not ready or has a stale scope.
- **UI**: `book-composer.tsx` generalizes to a list of books with per-book scope strips; a book picker built on the shelf query; a dialog hosting the composer from the header in `__root.tsx`; the spoiler notice in the conversation view.
- **Drafts**: a composer draft key for the header composer that is not tied to one book.
- **Data**: no migration.
- **Depends on** `rework-book-page` being archived and builds on `add-conversations-home`, whose conversations page is where multi-book conversations are found.
