## Context

See proposal.md for motivation; requirements are in `specs/book-ingestion/spec.md` and `specs/library-browsing/spec.md`.

How data is laid out today:

- An `editions` row is identified by `sha256`. Sections, passages, TOC entries, note refs, and locator aliases reference `editions.id` with `ON DELETE CASCADE`, so deleting the row removes the whole parsed structure.
- `library_files` rows link to editions **only by `sha256`**, with no foreign key. Rows for the upload source live under `<dataDir>/books`; rows for filesystem sources describe files in read-only library roots.
- Uploaded bytes are at `<dataDir>/books/<sha256>.epub` and covers at `<dataDir>/covers/<sha256>.<ext>`. Both are content-addressed, so neither is shared between editions.
- `scanLibraries` skips a file whose `(size, mtime)` is unchanged without hashing it. It hashes new or changed files (or every file when `full`), then calls `ensureEdition` and enqueues `library.ingest` for processing editions.
- `ingestEdition` parses the EPUB and writes the cover file **outside** a transaction, then calls `replaceEditionStructure` in one transaction. When the edition is missing it throws `NonRetryableError`, which marks the job failed.
- Locators embed the edition's `shortId`. `resolveLocator` already returns `not_found` when no edition has that short id.

## Goals / Non-Goals

**Goals:**
- One server-side operation that deletes an edition, safe to call twice and safe against a running ingest or reparse of the same edition.
- No database row or file left behind that a reader can see; leftover files on disk are acceptable only as a logged, harmless edge case.
- Keep the cheap unchanged-file path in scans: a deleted scanned book costs nothing on later incremental scans.

**Non-Goals:**
- Undo, a trash bin, or soft delete.
- Bulk deletion or deletion from the library list.
- A UI to view or edit the exclusion list. Re-uploading is the only way to un-exclude for now.
- Deleting or moving files in library directories.
- Changing what happens when a library file disappears (still "missing", never deleted).

## Decisions

### D1. Hard delete in one transaction, then remove files

`deleteEdition(db, dataDir, editionId)` in `src/modules/library`:

1. In a transaction:
   - `SELECT … FROM editions WHERE id = $1 FOR UPDATE`. If there is no row, return `{ deleted: false, reason: "not_found" }`.
   - Insert `(sha256, title)` into `excluded_editions` (`ON CONFLICT DO UPDATE` refreshes title and time).
   - Delete `library_files` rows for this `sha256` that belong to the **upload** source.
   - Delete the `editions` row. The cascade removes the structure.
2. After commit, delete `<dataDir>/books/<sha256>.epub` and the edition's `coverPath`, each with `rm({ force: true })`. Log failures but don't throw them.

Files are removed only after commit. If the order were reversed, a rolled-back transaction would leave a ready edition whose EPUB or cover is gone. If the transaction commits and a file removal then fails, the result is an orphan file, which nothing references. That is the safer failure.

*Alternative considered:* a `deleted` flag on `editions` (soft delete). Rejected: every query (browse, search, resolve, cover, availability) would need to filter on it. The user also chose plain not-found over a tombstone, so keeping the row has no benefit.

### D2. Exclusion list keyed by content hash

New table `excluded_editions (sha256 text primary key, title text not null, excluded_at timestamptz not null default now())`. It lives in the library module's schema. The title is kept only so a future management UI or the logs can say what was excluded.

*Alternatives considered:*
- A per-path `ignored` status on `library_files`. Rejected: it doesn't cover the same bytes appearing at a new path, and a full rescan would have to keep the flag in sync across re-hashes.
- No exclusion list. Rejected by the user: scanned books would come back on the next scan.

### D3. Keep filesystem `library_files` rows; check exclusion only after hashing

On delete, rows for filesystem sources are **kept**. Because of that, later incremental scans see the file as unchanged and skip it without hashing or touching editions. The fast path never creates editions, so it needs no exclusion check.

On the hashing path (a new path, a changed file, or a full rescan), `scanRoot` still calls `recordFile`, so path tracking stays correct. If `sha256` is in `excluded_editions`, it then **skips** `ensureEdition` and the enqueue, and counts the file in a new `ScanStats.excluded` counter. The check lives in the scanner, not in `ensureEdition`, because uploads need the opposite behavior (D4).

These kept rows have no edition, which is harmless: browse and detail queries start from `editions`, and `findReadableFile` is only called for existing editions. If the book is re-uploaded, these rows immediately show again as sources of the new edition, as the spec requires, without waiting for a scan.

### D4. Upload clears the exclusion

In `commitUpload`, `DELETE FROM excluded_editions WHERE sha256 = $1` runs before `ensureEdition`. The rest of the upload flow is unchanged: a new edition is created in `processing` and ingestion is enqueued.

`commitUpload` currently skips the rename when `<sha>.epub` already exists. It will now also `rename` over the target when no edition for that `sha256` exists, so a copy that a concurrent delete is about to remove is replaced with the new upload (see Risks). A live edition's copy is still kept, because ingestion may have it open, and replacing an open file fails on Windows.

### D5. Ingest and reparse tolerate a deleted edition

- At the start of `ingestEdition` and `reparseEdition`, a missing edition is logged at `info` level and returns a new `IngestOutcome` value, `"deleted"`. It no longer throws `NonRetryableError`, so the job completes instead of failing.
- At the start of `replaceEditionStructure`'s transaction, the edition row is locked with `SELECT … FOR UPDATE`. If the row is gone, the transaction writes nothing and returns `"deleted"`. `ingestEdition` then removes the cover file it just wrote, but only if no edition with that `sha256` exists by then (a re-upload may have recreated it).
- The delete (D1) takes the same row lock, so the two are serialized:
  - If ingest commits first, delete removes everything it wrote, including the cover named in `coverPath`.
  - If delete commits first, ingest sees no row and writes nothing.
- The failure path's `setEditionStatus(..., "failed")` already updates nothing when the row is gone. It needs no change.

*Alternative considered:* refusing to delete while an edition is `processing`. Rejected: a stuck or slow import is one of the main reasons to delete, and it would need a separate "cancel" concept.

### D6. Server function and UI

- `deleteEditionFn`: `createServerFn({ method: "POST" })`, validated with `z.object({ editionId: z.uuid() })`. It returns `{ deleted: boolean }` and treats not-found as success for the UI (the spec's "Book already deleted elsewhere" scenario). The existing access guard and same-origin checks already cover POST server functions.
- Book detail page: add a destructive "Delete book" button that opens a confirmation built on a new shadcn `alert-dialog` component (`src/components/ui/alert-dialog.tsx`, on the `radix-ui` package already installed). The dialog names the title and says the deletion can't be undone. When `sources` contains a `filesystem` entry, it adds that the file stays in the library folder and will be skipped by scans. Confirming calls the function, invalidates the `["editions"]` query, and navigates to `/`.
- No change is needed for the not-found pages and responses. Detail, cover, passage, search, resolve and verify already return not found once the rows are gone. Tests cover these cases.

## Risks / Trade-offs

- **[Race: re-upload between delete commit and file removal]**: a re-upload could rename its file into place, and delete's `rm` would then remove it. → Just before each `rm`, delete re-checks that no edition for that `sha256` exists and skips the removal if one does. The remaining window is milliseconds. If it is hit, ingestion fails with "no longer available" and the user can retry the import.
- **[Orphan files if removal fails]** (permissions, antivirus locks on Windows): files are left in `books/` or `covers/`. → Log them with the path. They are unreferenced and are overwritten if the same bytes are uploaded again. A cleanup sweep can be added later if needed.
- **[Exclusion list grows forever]**: one small row per deleted book. Negligible at personal-library scale.
- **[Irreversible]**: an accidental delete loses only derived data. The source EPUB is either in the library folder or re-uploadable. Re-import gives the same short id and parser version, so old locators resolve again. → A confirmation is required, and the proposal records that there is no undo.
- **[Kept filesystem rows look like sources of a deleted edition in raw SQL]**: no user-visible effect. This is documented in a code comment on the delete function.

## Migration Plan

- Add `excluded_editions` to the library schema and generate `drizzle/0001_*.sql` with `pnpm db:generate`. Migrations run automatically at startup, as they do today.
- Rollback: the table is additive. Older code ignores it, so downgrading the image is safe. Books deleted while on the newer version stay deleted, but a scanned one would be re-imported by an older version's next scan.
