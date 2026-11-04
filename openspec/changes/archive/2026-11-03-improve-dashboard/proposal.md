## Why

The library page loads and renders every book at once, and has no way to find a book or narrow the list (issue #35). That is fine with a few dozen books, but a library folder of a few thousand EPUBs makes the page slow to load, slow to poll during imports, and hard to use. Each book's status badge also says "Ready" for almost every book, which tells the reader nothing. The more useful fact, whether they have started or finished the book, is not on the page at all.

## What Changes

- **Infinite scroll.** The library list loads in pages in title order. Scrolling near the end loads the next page, with no "next page" control. Designed for libraries of up to 5,000 books.
- **Search by title and author.** A search box above the list matches part of a book's title or any author name, ignoring case. Searching inside book text is not part of this change.
- **One status per book.** Each book shows one status. Books that are processing, failed, or unavailable show that status as before (failed books keep their reason and retry action). Ready books show their reading state instead: **Not started**, **Reading**, or **Finished**, taken from the shared reading position. The "Ready" badge goes away.
- **Status filter.** A filter narrows the list to All, Not started, Reading, Finished, or Needs attention (processing, failed, or unavailable). Needs attention is offered only while at least one book is in one of those states.
- **Search and filter live in the URL**, so reloading, sharing a link, or coming back from a book keeps them. The count shows the total number of books, or "N of M books" while a search or filter is active. An empty result offers to clear the search and filter, instead of the upload guidance an empty library shows.
- Import status still updates without a reload while any book is processing.

Non-goals: searching passage text across books; sort orders other than title; filters by language, author, Guide, or conversations; reading positions per reader (the position stays shared by everyone on the instance).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `library-browsing`: The library list loads in pages as the reader scrolls, and ready books show their reading state instead of "Ready". New requirements cover searching the library by title and author and filtering it by status.

## Impact

- **New module** `src/modules/shelf`: a read-only query over the library and reading positions that returns one page of the library list, with search, the status filter, and the counts. It has no tables of its own. `biome.json` gets the module-boundary override for it.
- **`src/modules/library`**: exports the availability expression and status mapping that `shelf` reuses. `listEditions` is unchanged.
- **Server functions** (`src/fns/library.ts`): a new paged list function that takes the search text, filter, and cursor.
- **UI** (`src/routes/index.tsx`): search box, status filter, infinite scroll, the single status badge, the filtered count and empty state, and validated search params on the `/` route.
- **Database**: no schema changes or migrations. Indexes are not needed at this size.
- **Dependencies**: none new.
