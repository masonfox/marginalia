## Why

There is no way to remove a book from Marginalia. Test imports, duplicate editions, and books the reader no longer wants stay in the library, in search results, and on disk forever; the only workaround is hand-written SQL plus deleting content-addressed files, and a book from a scanned library folder comes straight back on the next scan.

## What Changes

- Add a **Delete book** action on the book detail page, behind a confirmation that names the book and says what will be removed.
- Deleting an edition removes, in one operation: the edition row and everything that cascades from it (sections, passages, TOC, note links, locator aliases), its `library_files` rows for the upload source, the uploaded EPUB under `<dataDir>/books/`, and its cover under `<dataDir>/covers/`.
- Files inside read-only library folders are never touched. Instead the edition's SHA-256 is recorded on an **exclusion list**, and scans skip any library file with that hash, so a deleted scanned book stays deleted.
- Uploading the same bytes again is an explicit request to bring the book back: it clears the exclusion and imports the book as a fresh edition. Scanned copies of those bytes are then picked up again as additional sources.
- Old passage links and locators for a deleted edition resolve as ordinary **not found**, exactly like locators that were never issued. No tombstone is kept.
- Deletion is safe against a concurrent import or reparse of the same edition: the job finishes as a no-op and cleans up anything it wrote, rather than resurrecting the book or failing with retries.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `book-ingestion`: adds the requirement to delete an edition with all its stored data, adds the exclusion list, makes scans skip excluded hashes, and makes an upload of excluded bytes clear the exclusion.
- `library-browsing`: the book detail page offers a confirmed delete action and returns to the library afterwards; links to a deleted book's pages and passages show not found.

## Impact

- **Database**: new `excluded_editions` table (sha256 primary key, title at deletion, deleted-at timestamp) and a migration.
- **Code**: `src/modules/library` (new delete action, exclusion checks in `scan.ts` and `upload.ts`), `src/modules/catalog/ingest.ts` and `persist.ts` (tolerate the edition disappearing mid-ingest), `src/fns/library.ts` (new `deleteEditionFn` server function), `src/routes/books.$editionId.tsx` (delete button and confirmation dialog).
- **Disk**: deletes files under `<dataDir>/books` and `<dataDir>/covers` only; library mounts remain read-only.
- **Access**: the new server function is a state-changing request and is covered by the existing session and same-origin checks in instance access; no new access rules.
- **Irreversible**: there is no undo. Recovery means re-uploading the EPUB, which creates new passages; the locator short id is derived from the hash, so old links work again after re-import.
