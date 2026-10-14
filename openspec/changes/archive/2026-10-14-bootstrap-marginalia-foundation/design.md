## Context

Greenfield repository: only OpenSpec scaffolding exists. See proposal.md (Why) for motivation and the roadmap of later changes. This design sets the architectural foundation for the whole project, not just this change, because module boundaries, the data model for passages, and the locator and position scheme are expensive to change once conversations and citations are stored against them.

Constraints from the brief: TypeScript end to end, TanStack Start, PostgreSQL as the only stateful service (database, search, and queue), Docker Compose deployment on AMD64 and ARM64, modular monolith, minimal infrastructure, and use for individuals or small households.

## Goals / Non-Goals

**Goals:**
- A module layout and data model that later changes (conversations, progress, providers, BookOrbit, memory) can extend without restructuring.
- Deterministic parsing, plus forwarding of old locators across reparses, so that any locator stored in a conversation resolves correctly forever.
- Spoiler boundaries expressible as one indexed SQL predicate (`reveal_position <= :bound`).
- One container and one database. No Redis and no separate search engine.

**Non-Goals:**
- AI providers, embeddings, pgvector usage, conversations (later changes).
- Per-person accounts or reader profiles (arrive with `add-reading-progress`). This change has one shared instance password only.
- A general library-provider interface. This change hard-codes the two sources (upload, filesystem), and `add-library-providers` extracts the abstraction once a third source (BookOrbit) exists to shape it.
- Serving under a URL subpath (root of a hostname only).
- A full EPUB reader. The passage view shows extracted text, not the publisher's styling.
- PDF, MOBI, or DRM-protected formats.

## Decisions

### D1. Modular monolith layout

```
src/
  routes/                 TanStack Start file routes (UI + API routes); thin
  server/
    config.ts             zod-validated env
    db/                   drizzle client, migrator, schema barrel
    jobs/                 queue bootstrap, job registry, worker lifecycle
  modules/
    access/               instance password, sessions, login rate limit, request guard (owns tables)
    library/              sources, files, editions, scanning, upload (owns tables)
    epub/                 pure parser: bytes → ParsedEdition (no DB, no I/O beyond the zip)
    catalog/              persisting ParsedEdition: sections, toc, passages, notes (owns tables)
    retrieval/            search, resolve, verify (reads catalog tables; read-only)
  components/ui/          shadcn/ui
```

Each module exposes a public `index.ts`. Other modules import only from that file, and Biome `noRestrictedImports` rules enforce this. Tables are defined inside the module that owns them, and only the owning module writes to them. `retrieval` reads `catalog` tables directly because that is its purpose, and this read-only access is documented as the one allowed exception.

`epub` is a pure function library with no database access, which makes it unit-testable against fixtures and reusable for reparsing.

*Alternatives:* a monorepo of packages (pnpm workspaces), rejected as more ceremony than one deployable needs at this size. Feature folders without enforced boundaries, rejected because later changes will blur them.

### D2. Job queue: pg-boss

Use **pg-boss** (v10+) on the same database, in its own `pgboss` schema. It provides `singletonKey` deduplication, retries with exponential backoff, per-queue concurrency (`teamSize`/`batchSize`), cron schedules that run once across instances, and job-state retention, which together meet the background-jobs spec without custom queue code.

- The worker starts inside the app process unless `MARGINALIA_WORKER=false`. The same image can run a dedicated worker with `MARGINALIA_ROLE=worker` (no HTTP listener except health).
- Job kinds in this change: `library.scan` (cron, singleton), `library.ingest` (key = sha256), `catalog.reparse` (key = editionId).
- The job registry in `server/jobs` maps kind → zod payload schema → handler, which keeps enqueue calls type-safe.

*Alternatives:* graphile-worker, also good, but it relies on its own migration tooling and its cron semantics fit less well. A hand-rolled `SKIP LOCKED` table, rejected because retries, backoff, cron, and dedup are what pg-boss already provides, and rebuilding them is premature work.

### D3. Data model (Drizzle)

```
library_sources   id, kind('upload'|'filesystem'), root_path, created_at
library_files     id, source_id, rel_path, size, mtime, sha256, status('available'|'missing'),
                  last_seen_at, UNIQUE(source_id, rel_path)
editions          id (uuid), sha256 UNIQUE, short_id (first 12 hex of sha256) UNIQUE,
                  title, authors jsonb, language, publisher, published, identifiers jsonb,
                  description, cover_path, epub_version,
                  status('processing'|'ready'|'failed'), error,
                  parser_version int, linear_passage_count int, search_config regconfig,
                  created_at, updated_at
sections          id, edition_id, spine_index, href, linear bool, title, UNIQUE(edition_id, spine_index)
toc_entries       id, edition_id, parent_id, ordinal, depth, label, passage_id
passages          id bigserial, edition_id, section_id, spine_index, block_index, locator text,
                  kind, text, cfi, element_id, position int NULL, reveal_position int,
                  tsv tsvector GENERATED ALWAYS AS (to_tsvector(search_config, text)) STORED
                  UNIQUE(edition_id, locator)
note_refs         from_passage_id, to_passage_id, PRIMARY KEY(from, to)
locator_aliases   edition_id, old_locator, target_locator NULL, match_kind('exact'|'split'|'merged'|'removed'),
                  created_at, PRIMARY KEY(edition_id, old_locator)
instance_settings key text PRIMARY KEY, value text        -- e.g. password_salt, password_hash
sessions          id, token_hash bytea UNIQUE, created_at, expires_at, last_seen_at
```

- "Edition unavailable" is derived (no `available` library file and no upload source), not stored, which avoids drift.
- `search_config` is copied onto `passages` (denormalized) so the generated column needs no join. A generated column may call `to_tsvector(regconfig, text)` because it is immutable.
- Indexes: GIN on `tsv`. B-tree on `(edition_id, reveal_position)` for bounded queries. B-tree on `(section_id, block_index)` for context windows.
- Uploaded files go into a content-addressed path `${MARGINALIA_DATA_DIR}/books/<sha256>.epub`. Covers go into `${DATA_DIR}/covers/<sha256>.<ext>`.
- Canonical text lives only in `catalog` tables. Later AI-derived analysis goes into separate tables that reference passages and never update them (book-structure spec, "Canonical text is separate").

### D4. Locators and positions

- **Locator format:** `<short_id>:v<parser_version>:<spine_index>.<block_index>`, for example `3f9a1c07b2de:v1:12.47`. It is human-copyable, URL-safe, carries the edition (so a locator never resolves into another edition) and the parser version (so a locator from an older parse can never be confused with a current locator that happens to have the same numbers), and is deterministic for a given parser version. The full sha256 stays in the DB. On a `short_id` collision (vanishingly rare), the ID extends to 16 hex characters.
- `block_index` counts emitted passages within the section after segmentation, including split pieces. Splitting is deterministic (sentence segmentation with `Intl.Segmenter('en'|lang)`, max 1,500 chars).
- **CFI** is stored per passage (element path from the spine itemref), so external progress expressed as CFI (BookOrbit, reading apps) can be mapped to a position later without reparsing.
- **position:** a contiguous integer over passages in linear sections, in spine order then document order. Passages in non-linear sections have `position = NULL`.
- **reveal_position:** defined by the book-structure spec. Unreferenced non-linear passages get `linear_passage_count + 1` (they are revealed only when the book is finished). Notes referenced from several places take the minimum referencing position.
- **Parser version** is an integer constant in `modules/epub`. Bumping it is a deliberate act and is required whenever segmentation output could change. Locator *strings* are stable within a parser version. Across versions, D4a forwards old locators to current passages.

### D4a. Locator forwarding on reparse

This follows the familiar pattern of keeping old identifiers as forwarding aliases, the way URL redirects or renamed-column shims do. Reparse is the only time locators change, so forwarding is computed there, once, inside the same transaction that replaces the structure.

**Matching** (pure function in `modules/catalog`, input = old passages + new parsed passages, both in spine/block order):
1. Normalize text with the same normalizer used for quote verification (D7).
2. **Align** the two ordered sequences of normalized-text hashes with a sequence diff (Myers/LCS, e.g. the `diff` package's `diffArrays`). Equal runs become `exact` matches. Because alignment respects order, a sentence repeated in chapters 3 and 9 maps to its own occurrence, not the first one found.
3. **Fill gaps.** Between consecutive exact anchors there is an unmatched old run and an unmatched new run. Within each gap, score every old/new pair by word-trigram overlap normalized by the *smaller* passage (`shared / min(|old|, |new|)`), using plain word overlap for passages under 3 words. A new passage that is a piece of a split old passage scores ≈1. An old passage absorbed into a merged new passage also scores ≈1.
   - Old → the highest-scoring new passage ≥ 0.6, ties broken by earliest position. A split maps to its first piece, as the spec requires. Kind is `split` when several new passages score ≥ 0.6 against the same old one, and otherwise `merged`. Several old passages may share one target.
   - No candidate ≥ 0.6 → `removed`, `target_locator = NULL`.
4. **Collapse chains.** Existing `locator_aliases` rows whose `target_locator` is an old locator are updated to that locator's new target, or to `removed`. Then every old current locator is inserted. As a result, every historical locator is one hop from a current passage.

Gaps are bounded by anchors and books are small, so cost is negligible. Scale is explicitly not a concern for this workload.

**Resolution** (`modules/retrieval`): parse the locator, look up the edition by `short_id`. If its version equals the edition's `parser_version`, do a direct lookup. If it's older, do one `locator_aliases` lookup and return the target passage with `{ superseded: true, currentLocator }`, or a `removed` result. A newer or never-issued version is `not_found`. `verifyQuote` resolves first, then verifies.

Later changes store citations as `(locator, quote)`. The quote and the passage CFI stay as a second check: after resolving, `verifyQuote` confirms the forwarded passage still contains the quoted text, and a mismatch is surfaced rather than trusted.

*Alternatives:* text-anchored IDs (W3C-annotation style quote + prefix/suffix selectors), rejected as primary IDs because they are long, ambiguous for repeated text, and still need position for spoiler bounds and context windows. They survive in a weaker form as the stored quote. Keeping every historical parse's passages in the database, rejected as duplicating canonical text for no reader benefit.

### D5. EPUB parsing approach

- Zip: **yauzl** (streaming, random access, no full-memory inflate of large books), wrapped in a small reader that rejects zip-slip paths and caps the total uncompressed size (zip-bomb guard, default 1 GB).
- XML/OPF/NCX/nav: **fast-xml-parser** for package documents. **htmlparser2 + domhandler** (XML mode, tolerant) for XHTML content, because it is forgiving of the malformed markup common in real EPUBs and fast enough.
- Encryption check: `META-INF/encryption.xml` entries whose algorithm is not one of the font-obfuscation algorithms (IDPF/Adobe) → fail with the DRM reason.
- Segmentation is a DOM walk that emits a passage at each outermost block element, treating `div` as a block only when it directly contains text. Notes are detected by `epub:type`/`role` (`doc-footnote`, `doc-endnote`, `noteref`), with a fallback heuristic: the target of a link whose text is a short numeral/symbol within `<sup>` is treated as a note if the target lives in a non-linear section or an `aside`.
- The cover comes from the EPUB 3 `cover-image` property, then the EPUB 2 `<meta name="cover">`, and is otherwise absent.

*Alternatives:* `epub2`/`epubjs`, rejected because they are browser-oriented or unmaintained, expose no element-level positions, and give little control over determinism.

### D6. Ingestion flow and idempotency

1. **Upload:** stream to a temp file in `DATA_DIR/tmp` while hashing, with a byte limit enforced during streaming (`MARGINALIA_MAX_UPLOAD_MB`, default 200), and validate the container. Then atomically rename to the content-addressed path, upsert the upload `library_files` row, upsert an `editions` row (`processing`), and enqueue `library.ingest` with `singletonKey = sha256`.
2. **Scan:** for each root in `MARGINALIA_LIBRARY_PATHS` (comma-separated), walk `*.epub` and compare `(size, mtime)` to `library_files`. Changed or new files are hashed and processed as in step 1, except that they are not copied. Rows not seen in the scan become `missing`. Symlinks are followed only within the root.
3. **Ingest handler:** if the edition is `ready` with the current parser version, it is a no-op. Otherwise it parses (pure), then in **one transaction** deletes any existing sections, toc, passages, and note_refs for the edition, inserts the new ones (batched `COPY`-style multi-row inserts), and sets status `ready`. When a previous structure existed under an older parser version (a reparse), the handler computes and writes locator aliases (D4a) from the old passages before deleting them, within the same transaction. A failure sets `failed` plus the error after the final retry. Unrecoverable parse errors (corrupt, DRM) are thrown as a non-retryable error class so they fail immediately.

The delete-then-insert-in-one-transaction approach makes retries and reparses idempotent and atomic, which satisfies both the background-jobs and book-structure atomicity requirements.

### D7. Search

- `websearch_to_tsquery(search_config, :q)` provides quoted phrases, `OR`, and `-` without failing on malformed input. In cross-edition search, each edition's config is applied via `passages.search_config`.
- Ranking uses `ts_rank_cd(tsv, query, 32)`, and `ts_headline` is computed only for the returned page (a subquery limits rows first, because `ts_headline` is expensive).
- The bound is applied in `WHERE reveal_position <= :max`, before `ORDER BY ... LIMIT`.
- Language mapping: ISO 639-1 code from `dc:language` → PostgreSQL built-in config (`en`→`english`, `fr`→`french`, …), with `simple` as the fallback.
- Quote verification normalizes both strings with NFKC, maps curly quotes, primes, en and em dashes, and ellipsis to ASCII equivalents, collapses whitespace, and lowercases, while keeping an offset map so the range reported is in original-text coordinates.

*Alternative:* pgvector hybrid search, deferred per the brief until evaluation shows FTS misses matter. The Compose file ships `pgvector/pgvector:pg17` so enabling it later needs no image swap.

### D8. Web layer

- TanStack Start server functions for UI data. A file-route API handler serves `/api/health` and `/api/uploads` (multipart streaming via `busboy`, because server-function bodies are buffered).
- Library status updates use TanStack Query polling (every 3 s while any edition is `processing`). SSE was considered, but polling is simpler and adequate for the status feature (library-browsing spec).
- Behind a proxy: rely on relative URLs. Where an absolute URL is unavoidable, use `MARGINALIA_PUBLIC_URL` if set, and otherwise `X-Forwarded-Proto/Host`.
- UI uses Tailwind v4 + shadcn/ui, kept minimal.

### D9. Configuration (env, zod-validated)

`DATABASE_URL` (required), `PORT` (3000), `MARGINALIA_DATA_DIR` (`/data`), `MARGINALIA_LIBRARY_PATHS` (empty), `MARGINALIA_SCAN_INTERVAL_MINUTES` (60; 0 disables), `MARGINALIA_MAX_UPLOAD_MB` (200), `MARGINALIA_WORKER` (true), `MARGINALIA_ROLE` (`all`|`web`|`worker`), `MARGINALIA_INGEST_CONCURRENCY` (2), `MARGINALIA_PUBLIC_URL` (optional), `AUTH_PASSWORD` (optional; set and non-empty → login required, unset or empty → open instance), `MARGINALIA_SESSION_DAYS` (30), `MARGINALIA_TRUST_PROXY` (false; when true, the client IP for rate limiting and the scheme for `Secure` cookies come from `X-Forwarded-*`), `LOG_LEVEL` (info). The config module redacts password values from any error or log output. Logging uses **pino** with JSON output.

### D10. Migrations

drizzle-kit generates SQL migrations that are committed to `drizzle/`. At startup the app takes `pg_advisory_lock(<constant>)`, runs the drizzle migrator, releases the lock, then starts pg-boss (which migrates its own schema) and the HTTP server. Any failure exits non-zero.

### D11. Container and release

- Multi-stage Dockerfile on `node:22-bookworm-slim` (glibc avoids musl issues with native deps; no native deps are planned anyway). The image runs as non-root `node`, uses `tini` as PID 1, and has a `HEALTHCHECK` against `/api/health`.
- GitHub Actions on tag `v*`: `docker buildx` for `linux/amd64,linux/arm64` with QEMU, pushed to GHCR with `docker/metadata-action` semver tags (`X.Y.Z`, `X.Y`, `latest`). CI on PRs runs typecheck, lint, unit, and integration tests.

### D12. Tooling and tests

- **pnpm**, TypeScript `strict`, **Biome** (lint and format, with import-boundary rules), and **Vitest**.
- **Unit tests:** the `epub` parser against fixtures. Fixtures are built programmatically by a small test helper (EPUB 2, EPUB 3, nested TOC, footnotes, endnotes, verse, DRM marker, corrupt zip), and one small public-domain EPUB (Standard Ebooks) is committed for realism.
- **Integration tests:** run against a real PostgreSQL started by **Testcontainers** (`pgvector/pgvector:pg17`), covering ingestion, idempotency, search bounds, and migrations.
- A **golden snapshot test** pins locators and text for the committed fixture, so any unintended segmentation change fails CI and forces a parser version bump.

### D13. Instance access (single password)

- **Password verification:** if `AUTH_PASSWORD` is non-empty at startup, enable auth. Load or create a random 16-byte `password_salt` in `instance_settings`. Compute `scrypt(password, salt)` and keep it in memory. Login compares `scrypt(input, salt)` against it with `timingSafeEqual`. scrypt's cost also slows guessing.
- **Session invalidation on password change:** `instance_settings.password_hash` stores the scrypt result. At startup, if it differs from the newly computed one, the app deletes all `sessions` rows and stores the new hash in one transaction. No per-session fingerprint is needed.
- **Sessions are stored in the database**, not stateless signed cookies, so logout and password changes truly revoke them without a separate signing-secret variable. The cookie `marginalia_session` holds 32 random bytes (base64url), and only their SHA-256 is stored. `last_seen_at` is updated at most once per hour, which keeps writes negligible. Expired rows are purged by a daily pg-boss cron.
- **Request guard:** a TanStack Start global request middleware runs before routes and server functions. Allowlist: `/login`, `/api/health`, and built assets. Without a valid session, document requests get a 302 to `/login?next=<path>` and everything else gets 401. `next` is accepted only if it is a same-origin path (starts with `/`, not `//`). The middleware also rejects non-GET requests whose `Origin` doesn't match the request host. Together with `SameSite=Lax`, this covers CSRF without tokens.
- **Login page:** a plain form posted to a server function, which works without client JS. It shows a generic "Incorrect password" message on failure, and a logout button sits in the app shell.
- **Rate limiting:** an in-memory fixed-window counter keyed by client IP (socket address, or the first `X-Forwarded-For` hop when `MARGINALIA_TRUST_PROXY=true`), 10 failures per 15 minutes. In-memory is enough for a single-process household deployment. With several processes the limit becomes per process, which is acceptable.
- **No password set:** the middleware is a pass-through, `/login` redirects to `/`, a warning is logged at startup, and the app shell shows a small "No password set: anyone who can reach this instance can use it" notice. Existing sessions are left in the table but ignored. If a password is set again later, the startup hash check (above) clears them anyway.
- **Compose:** `AUTH_PASSWORD: ${AUTH_PASSWORD:-}` reads the value from the shell or an `.env` file. An `.env.example` carries a commented `AUTH_PASSWORD=` line explaining that empty means no login. There is never a default value.
- *One variable, not two:* an earlier draft required a password unless `MARGINALIA_AUTH=none`, and offered `AUTH_PASSWORD_FILE` for Docker secrets. Both were dropped for simplicity, so the presence of `AUTH_PASSWORD` alone decides. A `_FILE` variant can be added later without breaking anyone.
- **Forward compatibility:** `add-reading-progress` adds reader profiles selected after this login (one instance password, then "who's reading?"). It can attach a `reader_id` to `sessions` without changing this flow.

*Alternatives:* HTTP Basic auth, rejected because it has no logout, the browser prompt is poor UX, and it sends the password on every request. Signed stateless cookies, rejected because revocation would need an extra secret and versioning. A full user-account system, deferred to the reading-progress change.

## Risks / Trade-offs

- [Locators change when the parser version changes, which could orphan stored citations] → Locators include the parser version, and reparse writes forwarding aliases (D4a), so old locators keep resolving. The golden snapshot test forces deliberate version bumps. Reparse is never automatic in this change.
- [Fuzzy gap matching forwards a locator to the wrong passage] → Matching is confined to the gap between exact anchors, the threshold is conservative (falling to `removed` rather than guessing), and stored quotes are re-verified after forwarding. Unit tests cover split, merge, removal, and repeated-text fixtures.
- [Malformed real-world EPUBs break the parser] → Use a tolerant HTML parser, treat per-section failures as warnings (the section becomes empty and the warning is recorded) rather than failing the whole book where possible, and include a fixture corpus in tests.
- [Large books (≈1M words) produce slow ingestion and big transactions] → Use batched inserts, keep one transaction per edition (acceptable at this size), and bound concurrency to 2 by default.
- [The heuristic footnote detection misclassifies superscript links] → Apply the heuristic only when semantic markup is absent, and require the target to be in a non-linear section or an aside. A misclassification degrades gracefully, because the passage is still searchable.
- [A shared password gives everyone equal access, and a weak password is guessable] → The deployment docs recommend a long passphrase, login attempts are rate-limited, scrypt slows each guess, and per-reader profiles arrive in `add-reading-progress`.
- [Session cookies sent over plain HTTP outside a trusted network can be intercepted] → `Secure` cookies are set whenever HTTPS is detected, and the docs direct anyone exposing the instance to use a TLS reverse proxy. The Compose example still binds to localhost by default.
- [With `MARGINALIA_TRUST_PROXY=true` and no proxy in front, a client can spoof `X-Forwarded-For` to dodge rate limiting] → It defaults to false, and the docs say to enable it only behind a proxy.
- [Read-only mounts with unreliable mtimes (some network filesystems)] → Hashing is the source of truth for identity. A manual "full rescan" option ignores the `(size, mtime)` cache.
- [pg-boss version upgrades migrate its schema] → Pin the major version, and pg-boss handles its own migrations at start.

## Migration Plan

This is the first release (`v0.1.0`), so there is no existing data. Rollback means running the previous image tag. Because drizzle migrations are forward-only, the docs instruct operators to back up the database (`pg_dump`) before upgrading.

## Open Questions

- Whether default `MARGINALIA_SCAN_INTERVAL_MINUTES` should be 60 or 15 for typical home-library churn. This is tunable and does not affect design.
- Choice of the committed public-domain fixture title. Any short Standard Ebooks title with footnotes works.
