# Marginalia

Marginalia is a self-hosted companion for reading your own EPUBs. It turns each book into precise, ordered, searchable passages, each with a stable citation locator. Later releases build AI discussion on top of this foundation: discussing a partly read novel without spoilers, with citations you can verify.

This release (0.1) provides the text foundation and a small reading UI:

- **Import** EPUB 2 and EPUB 3 files by upload, or by scanning read-only library folders. Books are identified by content, so each edition is imported once. **Delete** a book from its page; a book from a library folder stays deleted until you upload the same file again.
- **Structure**: metadata, cover, table of contents, spine-ordered sections, block-level passages, and footnotes and endnotes. Each passage has a reading-order position.
- **Citation locators** like `3f9a1c07b2de:v1:12.47`. They stay valid when the parser improves, because old locators forward to the passage that now holds their text.
- **Search** with PostgreSQL full-text search, using language-aware stemming, phrases, and highlighted snippets.
- **Optional single-password login**, persistent sessions, and login rate limiting.
- **One container plus PostgreSQL**, for `amd64` and `arm64`.

## Running it

See **[docs/deployment.md](docs/deployment.md)** for setup, every configuration variable, the instance password, volumes, external PostgreSQL, reverse proxies with HTTPS, and upgrades.

The short version:

```sh
cp .env.example .env    # set AUTH_PASSWORD (a long passphrase) and MARGINALIA_LIBRARY_DIR
docker compose up -d    # then open http://localhost:3000
```

Without `AUTH_PASSWORD`, anyone who can reach the instance can use it. Only do that on a trusted network or behind an authenticating proxy. Serve Marginalia over HTTPS whenever it is reachable from beyond a trusted network.

## Development

Requirements: Node.js 22.9+, pnpm (via Corepack), and Docker (integration tests start PostgreSQL with Testcontainers).

```sh
pnpm install
docker run -d --name marginalia-dev-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=marginalia -p 5433:5432 pgvector/pgvector:pg17
cp .env.development.example .env.development   # local settings, gitignored
pnpm dev
```

`pnpm dev` and `pnpm db:migrate` read `.env.development` if it exists. Variables already set in your shell take precedence. Production never reads this file.

| Command | What it does |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | TypeScript (strict) and Biome, including module-boundary rules |
| `pnpm test:unit` | Parser, matching, config, and other pure tests |
| `pnpm test:integration` | Database-backed tests (needs Docker) |
| `pnpm test:e2e` | Playwright checks against a running instance (see `playwright.config.ts`) |
| `pnpm db:generate` | Generate a migration after changing a Drizzle schema |

### Layout

A modular monolith. Each module exposes only its `index.ts`, and Biome rejects deep imports between modules.

```
src/
  routes/          TanStack Start pages and API routes (thin)
  fns/             server functions called by the UI
  server/          config, logging, database, migrations, job queue, boot, request guard
  modules/
    access/        instance password, sessions, login rate limit, request guard
    library/       sources, files, editions, upload, folder scanning
    epub/          pure EPUB parser: bytes → structure (no database)
    catalog/       storing parsed structure, locator forwarding on reparse
    retrieval/     search, citation resolution, quote verification (read-only)
```

### Parser versions

`PARSER_VERSION` in `src/modules/epub/types.ts` is part of every locator. A golden snapshot test pins the parser's output for a committed public-domain book (`test/fixtures/standard-ebooks.epub`, from [Standard Ebooks](https://standardebooks.org), CC0). If that test fails after a parser change, bump `PARSER_VERSION`, which starts a new golden file, instead of editing the existing one. Editions parsed with an older version can then be reparsed. Their old locators keep resolving.
