## Context

- The reading position is stored per edition in `reading_positions` (`src/modules/guide/schema.ts`). Its value is `max_position` (a reading unit's end position) plus `scope_label`, and both null means finished. Reading units come from the table of contents or spine (see the reading-scope spec). Positions are rebased when an edition is reparsed.
- AI credentials are the only secrets stored so far: `ai_credentials`, which uses AES-GCM with `MARGINALIA_SECRET_KEY` (`src/modules/settings/crypto.ts`). Its columns are fixed because every AI provider needs about the same config. Progress providers don't.
- Background jobs run on pg-boss (`src/server/jobs/runtime.ts`). Recurring jobs are set as `kind → cron | null` with `boss.schedule` and `unschedule`. pg-boss keeps schedules in PostgreSQL and fires each one once across all workers.
- `editions.identifiers` already holds the EPUB `dc:identifier` values, and `src/lib/edition-facts.ts` sorts them into ISBN, Goodreads, Hardcover and so on.
- Editions are identified by the SHA-256 of their file, so all `library_files` rows for an edition have the same bytes.

## Goals / Non-Goals

**Goals:**
- One provider contract. Adding a provider means writing an adapter, with no UI or schema work.
- All spoiler-relevant logic (mapping to units, rounding down, provider-wins) lives in the core and is tested once.
- Sync is cheap and polite: no network use while disabled, rate limits respected, and duplicate jobs collapsed.

**Non-Goals:**
- Pushing Marginalia's position back to any provider (sync is one way).
- More than one configuration per provider kind, or per-reader accounts. The position stays instance-wide.
- Creating editions or wishlist entries from provider books that aren't in the library.
- Syncing conversation scopes. Conversations keep their own bounds (reading-position spec).
- Combining readings from several providers. Only one source applies per book.
- Goodreads. It is deferred to a later change (see D8).

## Decisions

### D1. Providers return raw readings, and the core maps them

```ts
interface ProgressProvider<C> {
  kind: ProviderKind;
  label: string;
  configFields: ConfigField[];                 // { key, label, type: text|url|secret, hint?, required }
  help?: string;                               // short setup notes shown with the form
  testConnection(cfg: C): Promise<TestResult>; // ok | unreachable | rejected | rate-limited
  matching: ListMatching<C> | LookupMatching<C>;
}

type ProgressReading = {
  state: "reading" | "finished" | "not-started" | "abandoned";
  locator?: { kind: "spine"; index: number; offset?: number };
  fraction?: number;                           // 0..1
  pages?: { current: number; total: number };
  observedAt?: Date;
};
```

Adapters only fetch and parse. Turning a reading into a reading unit is done by one pure function, `mapReading(reading, units, linearText) → Position`, which the core owns. *Alternative considered:* letting each provider produce a unit directly. That was rejected because every adapter would then reimplement the round-down rule, and one bug in one adapter would leak spoilers.

The config form is generated from `configFields`. Secret fields use the existing masked, hint-only input pattern. `help` holds provider-specific setup text. *Alternative considered:* a hand-built panel for each provider. That was rejected as unneeded UI code, since the only per-provider differences are the fields and the help text.

### D2. Two matching modes

```ts
type ListMatching<C>   = { mode: "list";   list(cfg: C): Promise<ProviderBook[]> };
type LookupMatching<C> = { mode: "lookup"; keyFor(e: Edition): Promise<string | null>;
                                           get(cfg: C, key: string): Promise<ProgressReading | null> };
type ProviderBook = { externalId: string; isbns: string[]; ids: Record<string,string>;
                      title: string; reading: ProgressReading };
```

- **Hardcover** uses `list`. One sync fetches the reader's books with their readings, and the core matches them against editions.
- **BookOrbit** uses `lookup`, because its KOReader sync API has only `GET /api/v1/koreader/syncs/progress/:digest`. A sync looks up only the *candidate* editions: those already linked, those with a reading position, and those opened in the last 90 days. That keeps the request count bounded.

### D3. KOReader digest stored on the edition

KOReader's partial MD5 reads 1 KiB at offsets `1024 << 2i` for `i = -1..10` and takes the MD5 of the concatenation. LuaJIT masks the negative shift for `i = -1` to `1024 << 30`, which overflows to 0, so the first sample is the file head at offset 0, not 256. It depends only on the bytes, so it is computed during ingestion and stored as `editions.koreader_digest`. A one-off backfill job computes it for existing editions from any available library file. An edition with no available file has no digest and can only be linked by hand.

### D4. Data model

```
progress_providers
  kind            text PK  ('bookorbit' | 'hardcover')
  enabled         bool
  priority        smallint  unique   -- lower = wins
  schedule        text               -- 'manual' | '1h' | '6h' | '24h'
  config          jsonb              -- plain fields only
  secrets_ciphertext/iv/tag bytea    -- one encrypted JSON object of secret fields
  secret_key_id   text
  last_sync_at, last_sync_matched, last_error, updated_at

progress_links
  edition_id      uuid  FK editions ON DELETE CASCADE
  provider_kind   text  FK progress_providers ON DELETE CASCADE
  external_id     text
  matched_by      'auto' | 'manual'
  last_reading    jsonb               -- last raw reading seen
  last_fingerprint text               -- hash of the normalized reading last APPLIED
  PK (edition_id, provider_kind); unique (provider_kind, external_id)

progress_unmatched                   -- refreshed on each list-mode sync
  provider_kind, external_id, title, authors, isbns, reading, seen_at

editions
  + koreader_digest text, + progress_sync_excluded bool default false

reading_positions
  + source          text   -- 'manual' | provider kind
  + source_reading  jsonb  -- raw reading that produced the position, if synced
  + synced_at       timestamptz
  + moved_back_from text   -- previous unit label, when the last sync moved the position back
```

Secrets are stored as one encrypted blob, so the table doesn't need a column per secret field. The crypto helpers from `settings/crypto.ts` are reused.

### D5. Fingerprint decides "provider reported a change"

`fingerprint = hash(state, round(fraction, 4), pages, locator)`. It deliberately excludes `observedAt`, so a provider re-sending the same progress with a fresh timestamp doesn't override a manual edit. For each linked, non-excluded edition, sync takes the source provider (the lowest `priority` among enabled linked providers), then:

```
if reading.fingerprint == link.last_fingerprint: no-op           (manual edit survives)
else: position = mapReading(...); write it with source=provider; store fingerprint
```

The position write and the fingerprint update happen in one transaction. A manual edit sets `source='manual'` and leaves `last_fingerprint` unchanged.

### D6. Mapping algorithm

1. Get the ready edition's reading units, and the cumulative character count of its linear passages.
2. Find the target position:
   - **Spine locator:** the first linear position of spine section `index` (with `offset`, the passage within it, if given).
   - **Fraction:** the position where the cumulative character count reaches `fraction × total`.
   - **Pages:** `fraction = current / total`.
3. Pick the last unit with `endPosition < target` (with `≤` for a fraction landing exactly on a unit end). If there is none, the position is unset.
4. A state of `finished` or a fraction of 1 or more gives finished, and `not-started` gives unset.

Characters are a better proxy than passage count, because provider percentages come from rendered pages or byte offsets. The remaining error, including front matter that providers count, only ever lands a little early, because of step 3.

### D7. Jobs and scheduling

- `progress-sync` runs with data `{ kind }`, a dedupe key of `kind`, and concurrency 1 per kind.
- `progress-sync-book` runs with data `{ editionId }` and a dedupe key of `editionId`. It syncs every linked provider for the book, applying only the source.
- Saving a provider's schedule calls `boss.schedule('progress-sync', cron, { kind }, { key: kind })`, or `boss.unschedule('progress-sync', kind)` for manual or disabled. pg-boss keeps the schedule, so a web-only process can change it. Workers fire it.
- Hardcover requests are throttled in the adapter to stay under 60 per minute. A 429 response reschedules the remaining work rather than failing.

### D8. Goodreads deferred after a spike

Goodreads has had no API since 2020. A spike on 2026-11-07 against a public profile, with no sign-in, found:

| Source | Result |
|---|---|
| `review/list_rss/<id>?shelf=…` | 404, removed |
| `user/updates_rss/<id>` | 404, removed |
| `review/list/<id>?shelf=…` (HTML) | redirects to Sign in |
| `book/show/<id>` (HTML) | 202 with an empty body (AWS WAF JavaScript challenge) |
| `user_status/list/<id>?page=N` (HTML) | 200, public, rendered on the server: "is on page X of Y" (and "is N% done"), a Goodreads book id, and a time with no timezone |

A Goodreads provider would therefore have to scrape HTML and could report progress only:
- **No finished state.** The shelves need sign-in.
- **Weak matching.** It gets only a per-edition Goodreads book id. ISBN lookup would rely on the `book/auto_complete` JSON endpoint, which BookOrbit reports stays available while the WAF gates HTML pages.
- **Fragile.** The status list could fall behind the same challenge at any time.

BookOrbit, which issue #47 cited, uses Goodreads only for metadata (autocomplete and book-page scraping, with WAF detection). Its tracker sync targets Hardcover and StoryGraph. Goodreads is out of this change. The provider contract (D1, D2 list mode) already fits a later Goodreads adapter without core changes.

## Risks / Trade-offs

- **[Hardcover pages are for a different edition]** → The fraction is approximate, but rounding down means the error only puts the position early, never late. Readers may see a position a chapter behind. That is the accepted cost of being spoiler-safe.
- **[Goodreads, which the issue asked for, is missing]** → Deferred on the spike's evidence (D8). Goodreads readers can import into Hardcover and sync from there.
- **[BookOrbit lookup is one request per book]** → It only looks up candidate editions, and runs on the reader's LAN.
- **[Re-reads silently move the position back]** → This is intended (the provider wins). The control shows "moved back from …", so it is visible.
- **[A bad automatic match could apply someone else's progress to a book]** → Automatic linking needs an exact digest or ISBN match, and ambiguous matches go to the unmatched list.
- **[Reparse between sync and apply]** → Mapping and writing happen in one transaction against the current structure generation, and existing rebase logic handles later reparses.
- **[Secret key rotation]** → Handled the same way as `ai_credentials`, through `secret_key_id`.

## Migration Plan

- An additive migration creates the new tables and adds nullable or defaulted columns. Existing positions get `source = 'manual'`.
- A one-off job backfills `koreader_digest`.
- Rolling back means disabling all providers. The new columns and tables don't affect any existing feature.
