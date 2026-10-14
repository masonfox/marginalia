## 1. Data model

- [x] 1.1 Add the `excluded_editions` table (sha256 primary key, title, excluded_at) to `src/modules/library/schema.ts` and generate the migration with `pnpm db:generate`; verify `drizzle/0001_*.sql` creates only that table and `pnpm db:migrate` applies cleanly to the dev database

## 2. Delete operation

- [x] 2.1 Implement `deleteEdition(db, dataDir, editionId)` in `src/modules/library` per design D1 (row lock, exclusion upsert, delete upload-source `library_files` rows, delete edition, then remove `books/<sha>.epub` and the cover after commit, skipping removal if an edition for the sha exists again); verify with integration tests in `library.int.test.ts` that an uploaded ready edition leaves no edition, passage, TOC, alias, upload file row, EPUB file, or cover file behind, and that filesystem `library_files` rows are kept
- [x] 2.2 Cover the remaining delete cases in `library.int.test.ts`: deleting a failed edition, deleting a nonexistent id returns `not_found` and changes nothing, deleting twice is safe, and a library-directory file is left byte-for-byte unchanged; verify the tests pass with `pnpm test:integration`
- [x] 2.3 Export `deleteEdition` from `src/modules/library/index.ts` and verify `pnpm typecheck` passes

## 3. Exclusion in scan and upload

- [x] 3.1 In `scanRoot`, after hashing, skip `ensureEdition` and the enqueue for excluded hashes while still calling `recordFile`, and add `excluded` to `ScanStats` (design D3); verify with integration tests that an incremental scan, a full scan, and a copy of the same bytes at a new path all create no edition and enqueue nothing after the edition is deleted
- [x] 3.2 In `commitUpload`, clear the exclusion before `ensureEdition` and always rename the temp file over the content-addressed target (design D4); verify with an integration test that re-uploading deleted bytes creates a new `processing` edition, enqueues ingestion, removes the exclusion row, and that the kept library-directory file appears as an additional source

## 4. Concurrent ingest and reparse

- [x] 4.1 Make `ingestEdition` and `reparseEdition` return a new `"deleted"` outcome instead of throwing when the edition is missing, and update the job handlers in `src/server/jobs/handlers.ts` to log it; verify with an integration test that ingesting a deleted sha completes without error and leaves the job succeeded rather than failed
- [x] 4.2 Lock the edition row at the start of `replaceEditionStructure`'s transaction and write nothing if it is gone; in `ingestEdition`, remove the just-written cover when the outcome is `"deleted"` and no edition for the sha exists (design D5); verify with an integration test that deletes the edition between parse and persist (via the injectable `parse` dependency) and asserts no rows and no cover file remain

## 5. Server function and UI

- [x] 5.1 Add `deleteEditionFn` (POST, `{ editionId: z.uuid() }`, returns `{ deleted }`) to `src/fns/library.ts`; verify `pnpm typecheck` passes and that a request without a session is rejected when a password is set (existing guard tests pattern in `access.int.test.ts`)
- [x] 5.2 Add the shadcn `alert-dialog` component at `src/components/ui/alert-dialog.tsx` using the installed `radix-ui` package; verify `pnpm lint` and `pnpm typecheck` pass
- [x] 5.3 Add a destructive "Delete book" button and confirmation dialog to `src/routes/books.$editionId.tsx` that names the book, states it cannot be undone, adds the library-folder notice when any source is `filesystem`, and on confirm calls `deleteEditionFn`, invalidates `["editions"]`, and navigates to `/` (also when the book was already deleted); verify manually in `pnpm dev` that cancel keeps the page and confirm returns to a library list without the book

## 6. End-to-end and docs

- [x] 6.1 Add a Playwright test to `e2e/app.spec.ts` that uploads a book, deletes it through the dialog, checks it is gone from the library, and checks that its detail URL, cover URL, and a previously copied passage URL show not found; verify with `pnpm test:e2e`
- [x] 6.2 Document deleting books and the exclusion behavior for library folders (including that re-uploading the file undoes it) in `README.md` and `docs/deployment.md`; verify the docs test in `src/server/docs.test.ts` still passes
- [x] 6.3 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` and confirm all pass
