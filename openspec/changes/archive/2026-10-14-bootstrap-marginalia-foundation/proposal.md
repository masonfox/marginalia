## Why

Marginalia's value — discussing a partially read novel with an AI that cites the actual text and respects the reader's position — depends entirely on having the reader's EPUBs parsed into precise, ordered, searchable passages. Nothing exists yet, so the first change must deliver a deployable application and a trustworthy text foundation that every later capability (conversations, spoiler boundaries, integrations, memory) builds on.

This change covers delivery items 1–2 of the Marginalia brief. It deliberately excludes AI features so the canonical text layer, its citation locators, and its ordering model can be verified on their own before anything is generated on top of them.

## What Changes

- New TanStack Start + TypeScript application, structured as a modular monolith, backed by PostgreSQL via Drizzle ORM, with schema migrations applied automatically and safely at startup.
- A PostgreSQL-backed background job system used for scanning, ingestion, and indexing. Jobs are idempotent, retried on failure, and deduplicated.
- EPUB import from two sources: browser upload (copied into persistent storage) and one or more read-only library mounts (scanned, never written to). Files are identified by content hash so the same edition is never ingested twice and unchanged files are not reprocessed.
- Deterministic structural parsing of EPUB 2 and EPUB 3: metadata, spine-ordered sections, table of contents, block-level passages, and footnotes, each with a stable, edition-specific locator. Locators issued before a parser upgrade keep resolving after the book is reparsed, because old locators are forwarded to the passages that now hold their text.
- A global reading-order position on every passage (with footnotes revealed at the position of their first reference), so later changes can enforce spoiler boundaries with a simple retrieval predicate.
- PostgreSQL full-text search over passages, with ranking, highlighted snippets, an optional "at or before position" bound, and citation resolution/verification by locator.
- A minimal UI: library list, upload, import status, book table of contents, passage view by locator, and in-book search.
- Optional single-password instance access. If the operator sets `AUTH_PASSWORD`, users sign in through a login page that creates a long-lived session, with logout and brute-force limiting. If it is left unset, the instance is open and says so.
- Docker image (AMD64 + ARM64), reference Docker Compose file, environment-based configuration, health endpoint, and documentation for external PostgreSQL, persistent volumes, read-only mounts, and reverse proxies.

### Roadmap (subsequent changes, not part of this one)

1. `add-literary-conversations` — configurable AI providers (Vercel AI SDK), streaming persistent conversations, retrieval as a tool, verified citations, evidence-vs-interpretation framing, a challenging (non-sycophantic) discussion stance.
2. `add-reading-progress` — reader profiles (chosen after signing in with the instance password), manual progress by chapter/passage/location, spoiler-bounded retrieval enforced in the retrieval layer, conservative handling of approximate progress.
3. `add-library-providers` — provider abstraction (filesystem, manual, external), configurable processing triggers, and optional AI preprocessing (summaries, characters, themes) stored separately from canonical text.
4. `add-bookorbit-integration` — BookOrbit adapter for discovery, reading status, and progress sync.
5. `add-interpretive-memory` — durable, revisitable reader theories across conversations.
6. Hybrid pgvector retrieval, when full-text search proves insufficient.

## Capabilities

### New Capabilities

- `self-hosting`: Container image, reference Compose deployment, configuration, startup migrations, health checking, and supported deployment topologies (external PostgreSQL, read-only mounts, reverse proxy).
- `background-jobs`: Durable PostgreSQL-backed job execution with idempotency, deduplication, retries, and visible job status.
- `book-ingestion`: Importing EPUBs by upload and by scanning read-only library mounts, content-hash identity, change detection, and import status/failure reporting.
- `book-structure`: Deterministic extraction of metadata, sections, table of contents, passages, and footnotes, with stable edition-specific locators (forwarded across reparses) and a global reading-order position.
- `passage-retrieval`: Full-text passage search with snippets and an optional position bound, plus citation resolution (including forwarded locators) and quote verification by locator.
- `instance-access`: An optional single password set by one environment variable, login/logout flow, persistent sessions, protection of all pages and APIs, and login rate limiting.
- `library-browsing`: UI for listing books, viewing import status, browsing a book's table of contents, reading passages by locator, and searching within a book.

### Modified Capabilities

(none — greenfield project)

## Impact

- **New codebase**: entire application scaffold (TanStack Start, React, Tailwind, shadcn/ui, Drizzle, job runner, EPUB parser).
- **Dependencies**: PostgreSQL 16+ (pgvector-enabled image shipped in Compose for future use, extension not yet required), Node.js 22 LTS.
- **Persistent state**: database schema for library sources, files, editions, sections, passages, locator aliases, sessions, and jobs; a data directory for uploaded EPUBs.
- **Security posture**: when `AUTH_PASSWORD` is set, the instance is protected by one shared password, so everyone who knows it has equal access. When it is unset, the instance is open, which suits only a trusted network or an authenticating proxy. Per-person reader profiles arrive with `add-reading-progress`. Operators exposing the instance beyond their network should use HTTPS via a reverse proxy.
- **Distribution**: versioned multi-architecture images published by CI.
