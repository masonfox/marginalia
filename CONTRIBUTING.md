# Contributing to Marginalia

## Development setup

Requirements: Node.js 22.9+, pnpm (via Corepack), and Docker (integration tests start PostgreSQL with Testcontainers).

```sh
pnpm install
docker run -d --name marginalia-dev-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=marginalia -p 5433:5432 pgvector/pgvector:pg17
cp .env.development.example .env.development   # local settings, gitignored
pnpm dev
```

`pnpm dev` and `pnpm db:migrate` read `.env.development` if it exists. In a git worktree without its own copy, they read the main checkout's, and relative paths in it (such as `MARGINALIA_DATA_DIR`) resolve against the main checkout, so worktrees share its database and data. Variables already set in your shell take precedence. Production never reads this file.

Dependencies are not shared between worktrees, because a branch can change them. Each worktree runs its own `pnpm install`, which pnpm makes fast by linking files from its shared store. Worktrees created by [Orca](https://github.com/stablyai/orca) run that install automatically through the setup hook in `orca.yaml`.

| Command | What it does |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | TypeScript (strict) and Biome, including module-boundary rules |
| `pnpm test:unit` | Parser, matching, config, and other pure tests |
| `pnpm test:integration` | Database-backed tests (needs Docker) |
| `pnpm test:e2e` | Playwright checks against a running instance (see `playwright.config.ts`) |
| `pnpm db:generate` | Generate a migration after changing a Drizzle schema |

## Layout

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
    ai/            language model selection from environment configuration
    conversation/  conversations, retrieval tools, citations, chat streaming
    guide/         reading position, subjects, corrections, reader notes, glosses
```

## Citation locators and parser versions

Every passage has a citation locator such as `3f9a1c07b2de:v1:12.47`. Locators stay valid when the parser improves, because old locators forward to the passage that now holds their text.

`PARSER_VERSION` in `src/modules/epub/types.ts` is part of every locator. A golden snapshot test pins the parser's output for a committed public-domain book (`test/fixtures/standard-ebooks.epub`, from [Standard Ebooks](https://standardebooks.org), CC0). If that test fails after a parser change, bump `PARSER_VERSION`, which starts a new golden file, instead of editing the existing one. Editions parsed with an older version can then be reparsed. Their old locators keep resolving.
