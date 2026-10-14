## 1. Project scaffold

- [x] 1.1 Initialize a pnpm TanStack Start + React + TypeScript (strict) project with Tailwind v4 and shadcn/ui; verify `pnpm dev` serves a placeholder home page
- [x] 1.2 Add Biome (lint + format) with `noRestrictedImports` rules that only allow cross-module imports via `src/modules/*/index.ts`; verify `pnpm lint` passes and a deliberate deep import fails
- [x] 1.3 Add Vitest with separate `unit` and `integration` projects and a Testcontainers PostgreSQL (`pgvector/pgvector:pg17`) global setup; verify a trivial DB integration test passes
- [x] 1.4 Create the module skeleton (`server/{config,db,jobs}`, `modules/{access,library,epub,catalog,retrieval}`) with public `index.ts` files; verify typecheck passes
- [x] 1.5 Implement zod-validated config (D9) with errors naming each invalid or missing variable; verify unit tests for missing `DATABASE_URL`, a non-numeric `MARGINALIA_MAX_UPLOAD_MB`, auth enabled when `AUTH_PASSWORD` is non-empty and disabled when it is unset or empty, and that the password value never appears in error or log output
- [x] 1.6 Add pino logging configured by `LOG_LEVEL`; verify log output is JSON in production mode

## 2. Database and migrations

- [x] 2.1 Set up the Drizzle client and drizzle-kit config with migrations in `drizzle/`; verify `pnpm db:generate` produces SQL
- [x] 2.2 Define the `library_sources`, `library_files`, and `editions` tables in `modules/library`, and the `sections`, `toc_entries`, `passages` (with generated `tsv`), `note_refs`, and `locator_aliases` tables and indexes in `modules/catalog`, and `instance_settings` and `sessions` in `modules/access` (D3); verify the generated migration applies to a fresh database in an integration test
- [x] 2.3 Implement the startup migrator under `pg_advisory_lock` that exits non-zero on failure (D10); verify integration tests where two concurrent migrator runs apply each migration once and a broken migration causes a non-zero exit

## 3. Background jobs

- [x] 3.1 Integrate pg-boss with a typed job registry (kind → zod payload → handler), a typed `enqueue`, and a `NonRetryableError` class; verify an integration test that enqueues, processes, and completes a job
- [x] 3.2 Configure retries with exponential backoff, per-kind max attempts, and per-kind concurrency from config; verify tests for transient-failure-then-success, permanent failure with recorded error, and immediate failure on `NonRetryableError`
- [x] 3.3 Enforce deduplication via `singletonKey`; verify that enqueuing the same kind and key twice yields one job
- [x] 3.4 Implement worker lifecycle honoring `MARGINALIA_WORKER` / `MARGINALIA_ROLE`, with graceful shutdown on SIGTERM; verify that with the worker disabled jobs are enqueued but not processed
- [x] 3.5 Register the recurring `library.scan` cron from `MARGINALIA_SCAN_INTERVAL_MINUTES` (0 disables); verify that two worker instances on one database run the scheduled job once per interval

## 4. EPUB parser (pure, `modules/epub`)

- [x] 4.1 Build a programmatic EPUB fixture builder for tests (EPUB 2/NCX, EPUB 3/nav, nested TOC, fragments, footnotes, endnotes document, verse, long paragraph, non-linear appendix, DRM `encryption.xml`, corrupt zip, missing title) and add one small public-domain Standard Ebooks EPUB; verify fixtures open as valid zips
- [x] 4.2 Implement a safe zip reader on yauzl (zip-slip rejection, uncompressed size cap) and container/OPF loading, with errors for corrupt archives and missing package documents; verify unit tests for the corrupt-zip and zip-slip fixtures
- [x] 4.3 Detect DRM via `encryption.xml` (allowing only font-obfuscation algorithms); verify the DRM fixture fails with "DRM-protected content is not supported" and a font-obfuscated fixture passes
- [x] 4.4 Extract metadata (title fallback to file name, ordered authors, language, publisher, date, identifiers, description) and the cover image; verify unit tests for the EPUB 2, EPUB 3, and missing-title fixtures
- [x] 4.5 Build spine-ordered sections with linear flags, and parse the TOC from the nav document (falling back to NCX) into a nested hierarchy with href + fragment targets; verify the nested-TOC and EPUB 2 fixtures produce the expected trees
- [x] 4.6 Implement block-level segmentation (D5): passage kinds, whitespace normalization, `<br/>` → newline, script/style/empty exclusion, and deterministic sentence splitting above 1,500 chars; verify unit tests for paragraphs, verse, and long-block splitting with no text lost
- [x] 4.7 Detect notes (semantic `epub:type`/`role` first, then a constrained heuristic) and collect noteref links; verify the EPUB 3 footnote and endnotes-document fixtures produce correct note passages and links
- [x] 4.8 Compute locators (`<short_id>:v<parser_version>:<spine>.<block>`), per-passage CFI, element ids, `position`, `reveal_position` (D4), TOC entry → passage resolution, and `linear_passage_count`; verify unit tests for cross-chapter ordering, footnote reveal position, unreferenced appendix reveal, and fragment TOC resolution
- [x] 4.9 Add the `PARSER_VERSION` constant and a golden snapshot test of locators and text for the Standard Ebooks fixture; verify that parsing the same bytes twice is byte-identical and the snapshot passes

## 5. Library ingestion (`modules/library` + `modules/catalog`)

- [x] 5.1 Implement catalog persistence: a single transaction that deletes the edition's existing structure, batch-inserts sections, toc, passages, and note_refs, and sets status `ready` with the parser version and search config (language → regconfig mapping, fallback `simple`); verify an integration test that a retried ingest after a simulated mid-insert failure leaves exactly one complete passage set
- [x] 5.2 Implement the pure locator-matching function (D4a: normalized-text sequence alignment, gap fill by trigram overlap ≥ 0.6, `exact`/`split`/`merged`/`removed`); verify unit tests for renumbered-but-identical passages, repeated text in two chapters, a split, a merge, a removed passage, and determinism
- [x] 5.3 Write aliases during reparse in the replace transaction, collapsing earlier alias chains so every historical locator points one hop to a current passage; verify integration tests for a v1→v2 reparse (aliases written, no orphaned locators) and v1→v2→v3 (v1 and v2 locators both point to v3 passages), using a test-only parser-version override
- [x] 5.4 Implement the `library.ingest` handler (no-op when ready at the current parser version, `failed` + reason on final failure, non-retryable for corrupt/DRM); verify integration tests for success, DRM failure, and no-op re-run
- [x] 5.5 Implement the streaming upload endpoint (`/api/uploads`, busboy): temp file + hashing, size limit during streaming, container validation, content-addressed atomic rename, source/file/edition upserts, and enqueue; verify integration tests for valid upload, oversize rejection (nothing stored), non-EPUB rejection, and duplicate-bytes upload mapping to the existing edition
- [x] 5.6 Implement the filesystem scan (`library.scan`): recursive `*.epub` walk with symlinks constrained to the root, `(size, mtime)` skip cache, hashing of new or changed files, and missing/returned file handling, with no writes to the library root; verify integration tests on a read-only temp directory covering a new file, unchanged rescan (no reads or enqueues), replaced content (new edition), deleted file (edition unavailable but searchable), and returning file (no re-ingest)
- [x] 5.7 Add server functions for manual rescan (with a full-rescan option ignoring the cache), retry of a failed import, and reparse of editions with an outdated parser version; verify integration tests that each enqueues the right deduplicated job

## 6. Retrieval (`modules/retrieval`)

- [x] 6.1 Implement `search({ editionId?, query, maxPosition?, limit, offset })` using `websearch_to_tsquery`, `ts_rank_cd`, the bound in `WHERE`, and `ts_headline` only on the limited page; verify integration tests for in-book scoping, stemming, phrase search, unbalanced quotes, an unsupported language (`simple`), and a bound that excludes later passages, includes a revealed footnote, and still fills the limit
- [x] 6.2 Implement `resolve(locator, { context })` returning passage, edition, section title, TOC path, position, and neighbors within the section; following `locator_aliases` for older-version locators (returning `superseded` + `currentLocator`); and returning distinct `removed` and `not_found` results; verify integration tests for context windows at section edges, a superseded locator, a removed locator, and a never-issued locator
- [x] 6.3 Implement `verifyQuote(locator, quote)` with NFKC + typographic normalization and an offset map back to original coordinates, resolving through aliases first; verify unit tests for curly vs straight quotes, dashes, whitespace, case, and a fabricated quote, plus an integration test verifying a quote against a superseded locator
- [x] 6.4 Export the typed retrieval interface from `modules/retrieval/index.ts` and verify that a server-side caller test gets the same bounded results as the UI server function

## 7. Instance access (`modules/access`)

- [x] 7.1 Implement password setup at startup (salt creation in `instance_settings`, scrypt hash in memory, and deletion of all sessions when the stored hash differs) and `verifyPassword` with `timingSafeEqual`; verify integration tests that the correct password verifies, a wrong one fails, and a password change invalidates existing sessions after restart
- [x] 7.2 Implement DB sessions (32-byte random token, SHA-256 stored, `MARGINALIA_SESSION_DAYS` expiry, throttled `last_seen_at`, logout deletion, daily expired-session purge cron) and cookie settings (HttpOnly, SameSite=Lax, Secure when HTTPS per `MARGINALIA_PUBLIC_URL` or trusted `X-Forwarded-Proto`); verify integration tests for create/validate/expire/logout and that the cookie is `Secure` behind a trusted HTTPS proxy
- [x] 7.3 Implement the global request middleware (allowlist `/login`, `/api/health`, and assets; 302 to `/login?next=` for documents; 401 otherwise; same-origin `next` only; Origin check on non-GET; pass-through when no password is set, with a startup warning and an "unprotected instance" notice in the app shell); verify integration tests for page redirect with `next`, 401 on an unauthenticated upload (nothing stored), open health check, rejected `next=//evil.example`, rejected cross-origin POST, and no-password mode (pages open, `/login` redirects to the library, notice shown)
- [x] 7.4 Implement the per-client in-memory login rate limiter (10 failures / 15 min; client IP from the socket, or the first `X-Forwarded-For` hop when `MARGINALIA_TRUST_PROXY=true`); verify unit tests that the 11th attempt with the correct password is rejected, a different client is unaffected, and the window resets
- [x] 7.5 Build the login page (single password field, works without client JS, generic "Incorrect password" and "try again later" messages, redirect to `next`) and a logout button in the app shell; verify in the running app the full logged-out → login → original page → logout cycle

## 8. UI (`library-browsing`)

- [x] 8.1 Build the app shell and library page (cover/placeholder, title, authors, status, failure reason + retry, empty-state guidance, rescan button) with 3 s polling while any edition is processing; verify in the running app that an upload transitions from processing to ready without a reload
- [x] 8.2 Build the upload control with client-side size check and server error display; verify the oversize and non-EPUB messages in the running app
- [x] 8.3 Build the book detail page (metadata, sources with availability, passage count, parser version, nested TOC links); verify that selecting a chapter opens its first passage
- [x] 8.4 Build the passage view route `/p/$locator` (section text, highlighted and scrolled-to passage, position, previous/next section, footnote popover from noterefs, redirect of superseded locators to the current URL, and a "moved or removed" page for removed locators); verify by opening a footnote-referencing locator URL directly, a superseded locator URL (redirects), and a removed locator URL
- [x] 8.5 Build in-book search (snippets with highlights, section titles, links to the passage view, no-results state); verify that searching and selecting a result opens the right locator

## 9. Health, container, and deployment

- [x] 9.1 Implement `/api/health` (200 when `SELECT 1` succeeds, 503 otherwise); verify integration tests with the database up and stopped
- [x] 9.2 Honor `MARGINALIA_PUBLIC_URL` / `X-Forwarded-*` for any absolute URLs; verify a test request with forwarded headers produces https URLs
- [x] 9.3 Write the multi-stage Dockerfile (`node:22-bookworm-slim`, non-root, tini, HEALTHCHECK, `/data` volume); verify `docker build` succeeds and the container reports healthy
- [x] 9.4 Write the reference `compose.yaml` (`pgvector/pgvector:pg17`, named volumes for db and `/data`, example `:ro` library mount, app port bound to localhost by default, `AUTH_PASSWORD: ${AUTH_PASSWORD:-}`, and an `.env.example` with a commented password line); verify that `docker compose up` without a password reaches an open UI showing the unprotected notice, that with a password set from scratch it reaches the login page and then a working UI, and that after `down` + `up` with the same volumes books persist
- [x] 9.5 Verify that an external PostgreSQL works by running the app container against a standalone PostgreSQL 16 container with the bundled db service removed
- [x] 9.6 Add GitHub Actions: PR CI (typecheck, lint, unit, integration) and a tag-triggered buildx multi-arch (amd64, arm64) push to GHCR with `X.Y.Z`, `X.Y`, and `latest` tags; verify the workflow lints with `actionlint` and a dry-run build of both platforms succeeds locally with buildx
- [x] 9.7 Write the README and `docs/deployment.md`: every env var with default and purpose, volumes, read-only mounts, external PostgreSQL, a reverse proxy example (Caddy + nginx with an upload body-size note), upgrades with a `pg_dump` backup, setting `AUTH_PASSWORD` with passphrase advice, and leaving it unset only on a trusted network or behind an authenticating proxy, `MARGINALIA_TRUST_PROXY` guidance, and HTTPS guidance for anything exposed beyond a trusted network; verify every variable in `config.ts` appears in the docs

## 10. End-to-end acceptance

- [x] 10.1 Using the Compose deployment with a password set, log in, mount a read-only directory containing the public-domain fixture plus one uploaded EPUB, and confirm both reach ready, searching finds a known phrase, a result link opens the highlighted passage, and a footnote opens from its reference
- [x] 10.2 Restart the stack mid-ingestion of a large EPUB and confirm the job resumes and the edition ends with one complete passage set
