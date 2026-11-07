## 1. Goodreads spike

- [x] 1.1 Fetch the Goodreads RSS feeds, shelf pages and status list for a public profile without logging in, and record the results in design.md D8. (RSS removed, shelves need sign-in, book pages behind WAF, status list public.)
- [x] 1.2 Decide Goodreads' scope and update the proposal and the progress-sync spec. (Deferred to a later change. The private-profile check isn't needed.)

## 2. Data model

- [x] 2.1 Add Drizzle schema for `progress_providers`, `progress_links` and `progress_unmatched`, plus the new columns on `editions` and `reading_positions` (design D4). Generate a migration, and verify `pnpm drizzle-kit` check passes and existing positions read back with `source = 'manual'`.
- [x] 2.2 Implement the KOReader partial MD5 digest. Verify a unit test against a fixture digest produced by KOReader's algorithm.
- [ ] 2.3 Compute `koreader_digest` during ingestion, and add a one-off backfill job for existing editions. Verify with an integration test that an ingested and a backfilled edition both carry the expected digest.

## 3. Core mapping and apply

- [ ] 3.1 Implement the pure `mapReading` (design D6). Verify unit tests cover a mid-chapter fraction (rounds down), a fraction exactly at a unit end, a spine locator, pages, an early reading (unset), finished, not-started, and locator taking precedence over fraction.
- [ ] 3.2 Implement the reading fingerprint (design D5). Verify unit tests show `observedAt` doesn't change it and that a small fraction change does.
- [ ] 3.3 Implement `applyReading(editionId, provider, reading)`: choose the source by priority, skip excluded editions, run the fingerprint check, then map and write the position (bypassing the move-back confirmation, recording source, reading, `synced_at` and `moved_back_from`) in one transaction. Verify integration tests for: re-read moves back, manual edit survives an unchanged reading, new reading replaces manual edit, excluded book unchanged, lower-priority provider ignored.
- [ ] 3.4 Make manual position writes set `source = 'manual'` and clear `moved_back_from`. Verify the existing reading-position tests still pass, plus a new test for the source change.

## 4. Provider framework and credentials

- [x] 4.1 Define the `ProgressProvider` contract, `ConfigField`, `ProgressReading`, and the list/lookup matching types in `src/modules/progress`, plus a registry of built-in providers. Verify the types compile and the registry lists all kinds.
- [ ] 4.2 Implement provider config storage: plain fields as jsonb, secret fields as one encrypted blob using `settings/crypto`, and read models that return hints only. Verify integration tests show secrets never come back in plaintext and survive a round trip.
- [ ] 4.3 Implement matching: ISBN-13 normalization, identifier matching against `editions.identifiers`, ambiguous matches routed to unmatched, manual links taking precedence, and refreshing `progress_unmatched` for in-progress books only. Verify unit and integration tests for each spec scenario under "Matching books to provider books".

## 5. Jobs and scheduling

- [ ] 5.1 Add the `progress-sync` (`{ kind }`) and `progress-sync-book` (`{ editionId }`) job kinds with dedupe keys, plus a handler that runs list or lookup sync and records `last_sync_at`, `last_sync_matched` and `last_error`. Verify a job integration test with a fake provider.
- [ ] 5.2 Pick candidate editions for lookup-mode providers (linked, positioned, or opened in the last 90 days). Verify with a unit test of the selection query.
- [ ] 5.3 Apply schedules when settings are saved, using `boss.schedule` and `unschedule` keyed by kind. Verify an integration test shows a schedule change takes effect without a restart and that disabling unschedules.

## 6. Settings UI and server functions

- [ ] 6.1 Add server functions to save, enable, reorder, test and "Sync now" each provider, to list unmatched books, to link one to an edition by hand, and to unlink. Verify integration tests through the server functions.
- [ ] 6.2 Build the "Reading sync" settings section: a form generated from `configFields` with masked secrets, per-provider help, a schedule preset picker, a priority order, test connection, Sync now, last-sync status and error, and an unmatched list with an edition picker. Verify with component tests and a manual check at phone width.

## 7. Position control

- [ ] 7.1 Show a synced position's source, raw reading and relative time, plus the "moved back from …" note, in the position control. Verify component tests for the spec scenarios under "Position source".
- [ ] 7.2 Add per-book "Sync" and "Exclude from sync / Include in sync" actions to the position control. Verify component tests and an integration test that an excluded book isn't changed.

## 8. Built-in providers: BookOrbit and Hardcover

- [ ] 8.1 BookOrbit adapter: config (URL, username, key secret), `testConnection` via `users/auth`, and lookup by digest that parses percentage and `DocFragment[n]` xpointer into a spine locator. Verify unit tests against recorded fixtures for success, 401, unreachable and empty progress.
- [ ] 8.2 Hardcover adapter: config (token secret), `testConnection` via `me`, a list query for user books with status, ISBNs and latest read progress, mapped to `ProgressReading`, plus a throttle under 60 requests per minute and backoff on 429. Verify unit tests against recorded GraphQL fixtures, including rate-limit handling.

## 9. Docs and end-to-end

- [ ] 9.1 Add a "Reading sync" section to `docs/deployment.md` covering providers, outbound hosts, the shared-position caveat, round-down behavior, and BookOrbit setup on the same library folder. Verify the docs test passes.
- [ ] 9.2 Add an e2e test that configures a fake provider through Settings, runs Sync now, and checks that the book page shows the rounded-down chapter with its source. Verify `pnpm test:e2e` passes.
