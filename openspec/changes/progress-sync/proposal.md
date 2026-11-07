## Why

Readers already track progress in another app (BookOrbit, Hardcover, Goodreads), so setting Marginalia's reading position by hand is duplicate work that falls behind. Marginalia should take its position from those trackers (issue #47). Sync is one way only, and the provider always wins. Because the position is also Marginalia's spoiler fence, sync must never move it past text the reader has finished.

## What Changes

- Add pluggable **progress providers**. Each provider declares its own configuration fields: plain fields, and secret fields that are stored encrypted. It also declares how it matches books and returns raw readings (state, fraction, pages, or a precise locator). Marginalia ships three:
  - **BookOrbit**, through its KOReader sync API, matched by the KOReader partial-MD5 digest of the edition's file.
  - **Hardcover**, through its GraphQL API with a personal token, matched by ISBN or Hardcover id.
  - **Goodreads**, through public RSS feeds and matched by ISBN or Goodreads id. A spike must confirm it is viable first, and it can be dropped without affecting the others.
- Map raw readings to a reading position in one shared step that always **rounds down to the last finished reading unit**, never to the unit currently being read. A reading short of the first unit's end gives an unset position, and a finished reading gives "finished".
- Configure each provider in Settings: enable or disable it, set its priority, and set its own sync schedule (manual only, or a preset interval). A provider also gets "Test connection" and "Sync now". A book can be synced on its own from its position control.
- Link editions to provider books automatically where possible. Unmatched provider books that the reader is reading are listed in Settings with a "link to edition" picker. Provider books with no edition in the library are ignored. A reader can opt a single book out of sync.
- When several providers match one book, the highest-priority provider is the book's only source.
- **The provider wins.** A changed reading is applied even if it moves the position back, for example on a re-read, and needs no confirmation. A manual edit on a synced book stays until the provider's raw reading next changes.
- The position control shows where a synced position came from: the provider, the raw reading, and the time of the sync. It also says when sync moved the position back.

## Capabilities

### New Capabilities
- `progress-sync`: provider abstraction and configuration, book matching and linking, scheduled and manual sync, mapping readings to a spoiler-safe position, per-book opt-out, and the three built-in providers.

### Modified Capabilities
- `reading-position`: a position applied by sync bypasses the confirmation for moving back. A position records its source (manual or a provider) and shows it in the position control. A manual edit on a synced book stays until the provider reports a change.

## Impact

- **Database**: new `progress_providers` table (one row per provider kind, with secrets encrypted using `MARGINALIA_SECRET_KEY`), new `progress_links` table, and new source and sync columns on `reading_positions`. Drizzle migrations are needed.
- **Jobs**: new pg-boss job kinds for each provider sync and each book sync. Schedules are created and removed at runtime from Settings rather than from environment variables at boot.
- **Code**: a new `src/modules/progress` module (provider contract, adapters, mapping, sync). Also touched: settings server functions and UI, the reading position control, and the reading position write path in `src/modules/guide`.
- **Outbound network**: calls to the BookOrbit instance URL the reader configures, to `api.hardcover.app`, and to `goodreads.com` RSS. None happen unless a provider is enabled.
- **Docs**: a new reading sync section in `docs/deployment.md`.
