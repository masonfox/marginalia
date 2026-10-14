# Deploying Marginalia

Marginalia runs as one container next to one PostgreSQL database. Everything stateful lives in PostgreSQL (books, passages, search index, job queue, sessions) and in one data volume (uploaded EPUBs and covers). The reference `compose.yaml` in the repository sets up both.

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Setting a password](#setting-a-password)
- [Volumes and library folders](#volumes-and-library-folders)
- [Using an existing PostgreSQL server](#using-an-existing-postgresql-server)
- [Behind a reverse proxy (HTTPS)](#behind-a-reverse-proxy-https)
- [Upgrading](#upgrading)
- [Running a separate worker](#running-a-separate-worker)

## Quick start

```sh
mkdir marginalia && cd marginalia
curl -O https://raw.githubusercontent.com/OWNER/marginalia/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/OWNER/marginalia/main/.env.example
# Edit .env: set AUTH_PASSWORD and POSTGRES_PASSWORD, point MARGINALIA_LIBRARY_DIR at your EPUBs.
docker compose up -d
```

Open <http://localhost:3000>. The port is bound to `127.0.0.1` only. To reach Marginalia from other devices, put a reverse proxy with HTTPS in front of it (see below), or change the `ports` line if your network is trusted.

Images are published for `linux/amd64` and `linux/arm64` as `ghcr.io/OWNER/marginalia:<tag>`. Tags are the full version (`0.1.0`, which never changes), the minor line (`0.1`), and `latest`. Set `MARGINALIA_IMAGE` in `.env` to pin a version.

## Configuration

All configuration comes from environment variables. They are validated at startup. An invalid or missing value stops the container with a message naming the variable and the expected format. Empty values count as unset.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | *(required)* | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/marginalia`. PostgreSQL 16 or newer. |
| `AUTH_PASSWORD` | *(unset)* | The instance password. Set and non-empty: a login is required. Unset or empty: the instance is open to anyone who can reach it. See [Setting a password](#setting-a-password). |
| `PORT` | `3000` | HTTP port inside the container. |
| `HOST` | `0.0.0.0` (in the image) | Address the HTTP server listens on. |
| `MARGINALIA_DATA_DIR` | `/data` | Where uploaded EPUBs (`books/`), covers (`covers/`), and temporary upload files (`tmp/`) are stored. Mount a volume here. |
| `MARGINALIA_LIBRARY_PATHS` | *(empty)* | Comma-separated folders to scan for `*.epub` files, e.g. `/library,/more-books`. Scanned on startup, on an interval, and on demand. Never written to. |
| `MARGINALIA_SCAN_INTERVAL_MINUTES` | `60` | Minutes between automatic library scans. `0` disables scheduled scans (startup and manual scans still run). |
| `MARGINALIA_MAX_UPLOAD_MB` | `200` | Largest EPUB accepted by upload, in megabytes. Larger uploads are rejected while streaming, and nothing is stored. |
| `MARGINALIA_INGEST_CONCURRENCY` | `2` | How many books one process imports at the same time. |
| `MARGINALIA_WORKER` | `true` | Whether this process runs background jobs (scans, imports). With `false` it still queues jobs for another process to run. |
| `MARGINALIA_ROLE` | `all` | `all` serves the web UI and runs jobs. `web` only serves the UI (implies no worker). `worker` only runs jobs and answers the health check. |
| `MARGINALIA_PUBLIC_URL` | *(unset)* | The external URL, e.g. `https://books.example.com`. Used for the few absolute URLs Marginalia generates, and marks the session cookie `Secure` when it is `https`. |
| `MARGINALIA_TRUST_PROXY` | `false` | Trust `X-Forwarded-For` and `X-Forwarded-Proto` from a reverse proxy. See [the proxy section](#trusting-the-proxy). |
| `MARGINALIA_SESSION_DAYS` | `30` | How long a login lasts. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. Logs are JSON on stdout. |
| `AI_PROVIDER` | *(unset)* | `openai`, `anthropic`, `google`, or `openai-compatible`. Unset disables AI: the library, search, and reading work as before, and conversations show setup guidance. See [AI conversations](#ai-conversations). |
| `AI_MODEL` | *(unset)* | The model name, e.g. `claude-sonnet-5-5`, `gpt-5`, `gemini-2.5-pro`, or `llama3.1`. Required when `AI_PROVIDER` is set. See [choosing a model](#choosing-a-model-and-controlling-cost). |
| `AI_API_KEY` | *(unset)* | The provider API key. Required for every provider except `openai-compatible`, where it is optional. Never logged or shown in the UI. |
| `AI_BASE_URL` | *(unset)* | The provider endpoint. Required for `openai-compatible` (e.g. `http://ollama:11434/v1`), and an optional override for the others (for example a proxy). |
| `AI_MAX_STEPS` | `8` | The most tool calls (search, read, outline) the assistant may chain while answering one message. |
| `AI_TEMPERATURE` | *(unset)* | Sampling temperature from 0 to 2. Unset uses the provider default. **Ignored by current Anthropic models** (Claude Sonnet 5.5, Opus 5.5, Haiku 5.5), which reject sampling settings: the request goes ahead without it and a warning is logged. Unset it for those models. |
| `AI_EFFORT` | *(unset)* | Reasoning effort: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Unset uses the model's default. A level the model does not support is adjusted or dropped by the provider library, with a logged warning, not an error. See [controlling cost](#choosing-a-model-and-controlling-cost). |
| `AI_PROMPT_CACHE` | `true` | Ask the provider to cache the unchanged start of each request (Anthropic). Set `false` to turn it off. OpenAI and Google cache on their own and ignore this. |
| `AI_PRICES` | *(unset)* | Price overrides for the cost estimates shown in conversations, as JSON in USD per million tokens: `{"my-model": {"input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75}}`. `cacheRead` and `cacheWrite` are optional and default to the input price. Entries add to or replace the built-in Anthropic prices. |
| `MARGINALIA_MIGRATIONS_DIR` | `/app/drizzle` (in the image) | Location of the database migrations. Only change this if you build your own image layout. |
| `NODE_ENV` | `production` (in the image) | Runtime mode. Leave as is. |

Database migrations run automatically at startup, before the server accepts requests. Several instances starting at once are safe: a PostgreSQL advisory lock makes them apply each migration exactly once. If a migration fails, the container exits with a non-zero status and logs the failing migration.

## AI conversations

Conversations let you discuss a book with a language model that searches and quotes the actual text. They are off until you choose a provider. Configuration is by environment variables only; if a provider is set but its model, key, or base URL is missing, Marginalia refuses to start and names the variable (it never prints the key).

**Hosted provider** (in `.env`, then `docker compose up -d`):

```sh
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-5-5
AI_API_KEY=sk-ant-...
AI_EFFORT=medium
```

**Local model with an OpenAI-compatible endpoint** (for example Ollama), where nothing leaves your network:

```sh
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://host.docker.internal:11434/v1
AI_MODEL=llama3.1
```

Small local models vary in how well they call tools and follow the citation format. Citations are always checked against the book regardless, and anything that does not match is shown as unverified.

**What is sent to the provider.** Each message you send, the earlier messages of that conversation, and every passage the assistant reads or searches for are sent to the configured provider to produce a reply. With a hosted provider, that text leaves your instance. Use a local endpoint if that is not acceptable. Marginalia has no reading progress yet, so the assistant can read, and may reveal, any part of the book.

Conversations are stored in your PostgreSQL database. Deleting a book deletes the conversations about it.

### Choosing a model and controlling cost

**Recommended setup.** Use **Claude Sonnet 5.5** (`claude-sonnet-5-5`) for conversations. It is a current model and costs less per token than Sonnet 4.5 ($2 / $10 per million input / output tokens, against $3 / $15). For higher-quality discussion at about twice the price, use **Claude Opus 5.5** (`claude-opus-5-5`). A small model such as **Claude Haiku 5.5** (`claude-haiku-5-5`) is meant for bulk background work, not conversations.

Most of a conversation's cost is input, not output. To answer one message the assistant runs a loop of tool calls (search, read, outline), and each step sends the instructions, the tool descriptions, and everything retrieved so far back to the model. Two settings keep that in check:

- **Prompt caching** (`AI_PROMPT_CACHE`, on by default). With Anthropic, Marginalia asks the provider to cache the unchanged start of each request. Every step after the first then pays the cached rate (a tenth of the input price or less) for what it repeats, and so does a follow-up message sent within about five minutes. After a longer pause the first step writes the cache again, at a little above the input price. OpenAI and Google cache automatically; local endpoints do not cache.
- **Reasoning effort** (`AI_EFFORT`). Current Claude models always reason before answering, and that reasoning is billed as output. Effort sets how much. Sonnet 5.5 defaults to `high`; start with `medium`, and try `low`, which often holds up well for discussion. Higher levels cost more and are rarely needed here.

`AI_TEMPERATURE` has no effect on current Anthropic models. If you set it for an older model, remove it when you switch; leaving it set only logs a warning on each reply.

**Seeing what conversations cost.** Each assistant reply shows a small line with its input tokens (and how many of them came from the cache), its output tokens, and an estimated cost. The conversation header shows the running total, including failed attempts that were retried. Replies from before this feature show no usage, and the total says so. A reply you stopped is marked "partial", because a step cut off mid-stream is not counted.

**Costs are estimates.** They are computed from token counts and a built-in table of Anthropic prices, and can differ from your provider's bill (for example after a price change, or when a provider bills differently, such as Haiku 5.5's higher price for prompts over 100,000 tokens). The token counts are exact. For other providers or models, add prices with `AI_PRICES`; a model with no known price shows tokens and no cost. Correcting a price also corrects the estimates for earlier replies, since costs are computed when shown.

## Setting a password

Marginalia has one shared password for the whole instance, set with `AUTH_PASSWORD`. Everyone who knows it has the same access. Per-reader profiles come in a later release.

- **Use a long passphrase**, for example four or five random words. Login attempts are limited to 10 failures per 15 minutes per client, and each check is deliberately slow, but a long passphrase is what really keeps guessing out.
- Put it in the `.env` file next to `compose.yaml` (`AUTH_PASSWORD=...`) or export it in your shell. The reference `compose.yaml` passes it through as `AUTH_PASSWORD: ${AUTH_PASSWORD:-}` and never contains a default.
- **Changing the password** and restarting logs everyone out.
- The password is never logged or sent to the browser. Only a salted scrypt hash is kept in the database, to detect a change.

**Leaving `AUTH_PASSWORD` unset or empty disables the login.** Anyone who can reach the instance can read your library, upload books, and trigger scans. Marginalia logs a warning at startup and shows a notice on every page. Only do this when the instance is reachable solely on a trusted network, or sits behind a reverse proxy that does its own authentication (for example an SSO proxy).

## Volumes and library folders

| Mount | Purpose |
| --- | --- |
| `/data` (volume `app-data`) | Uploaded EPUBs and extracted covers. Back it up together with the database. |
| `/var/lib/postgresql/data` on the `db` service (volume `db-data`) | The database: books, passages, search index, jobs, sessions. |
| `/library` (your folder, **read-only**) | Your existing EPUB collection. |

Mount library folders **read-only** (`:ro`). Marginalia only reads them. It never creates, modifies, or deletes anything inside. To use several folders, mount each one and list all of them:

```yaml
    environment:
      MARGINALIA_LIBRARY_PATHS: /library/fiction,/library/essays
    volumes:
      - /srv/books/fiction:/library/fiction:ro
      - /srv/books/essays:/library/essays:ro
```

Books are identified by the SHA-256 of their bytes:

- The same file uploaded and present in a folder is one book.
- A file whose size and modification time haven't changed is never re-read.
- A file that disappears is shown as *unavailable*, but stays readable and searchable.
- If your folder lives on a network filesystem with unreliable modification times, use **Rescan library** with a full rescan, or restart the container.

### Deleting books

**Delete book** on a book's page permanently removes it: its passages, search entries, cover, and (for uploads) the stored EPUB in `/data`. Conversations about the book are deleted with it. There is no undo, and links to its passages stop resolving.

Marginalia never deletes files in library folders. Instead it remembers the deleted book's SHA-256, and scans skip any file with those bytes, at any path, including on a full rescan. To bring the book back, upload the same file: this clears the exclusion and imports it again, with the same citation locators as before. Any library copies show up as sources again. To get rid of the file itself, delete it from the folder yourself.

## Using an existing PostgreSQL server

Marginalia works with any reachable PostgreSQL 16 or newer server. It needs no extensions in this release. The bundled image (`pgvector/pgvector:pg17`) only prepares for future features.

1. Create a database and a user that owns it:

   ```sql
   CREATE USER marginalia WITH PASSWORD 'a strong password';
   CREATE DATABASE marginalia OWNER marginalia;
   ```

2. Remove the `db` service, its `depends_on` entry, and the `db-data` volume from `compose.yaml`. Then point `DATABASE_URL` at your server:

   ```yaml
   DATABASE_URL: postgres://marginalia:a%20strong%20password@db.example.lan:5432/marginalia
   ```

   Percent-encode special characters in the password. Add `?sslmode=require` if your server requires TLS.

Marginalia creates its own tables, plus a `pgboss` schema for the job queue.

## Behind a reverse proxy (HTTPS)

**Serve Marginalia over HTTPS whenever it is reachable from beyond a trusted network.** Otherwise the password and session cookie travel in clear text. Run a TLS-terminating reverse proxy in front of the container, at the root of a hostname (subpaths are not supported). Then set:

```yaml
      MARGINALIA_PUBLIC_URL: https://books.example.com
      MARGINALIA_TRUST_PROXY: "true"
```

Allow request bodies at least as large as `MARGINALIA_MAX_UPLOAD_MB`, or EPUB uploads will fail at the proxy.

**Caddy** (obtains certificates automatically, no body size limit by default):

```caddyfile
books.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

**nginx:**

```nginx
server {
    listen 443 ssl;
    server_name books.example.com;
    # ssl_certificate / ssl_certificate_key ...

    # Must be at least MARGINALIA_MAX_UPLOAD_MB (default 200 MB).
    client_max_body_size 210m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_request_buffering off;
    }
}
```

### Trusting the proxy

With `MARGINALIA_TRUST_PROXY=true`, Marginalia takes the client address for login rate limiting from the first `X-Forwarded-For` entry. It also takes the scheme for `Secure` cookies from `X-Forwarded-Proto`. Without it, every request seems to come from the proxy, so one person's failed logins would lock out everyone.

**Enable it only when a proxy you control is in front and the container is not reachable directly.** Otherwise a client can set those headers itself, for example to dodge the login limit. The reference Compose file binds the port to `127.0.0.1`, which keeps direct access to the local machine.

## Upgrading

Database migrations are forward-only. **Back up before upgrading:**

```sh
docker compose exec db pg_dump -U marginalia -Fc marginalia > marginalia-$(date +%F).dump
# and the data volume, e.g.:
docker run --rm -v marginalia_app-data:/data -v "$PWD":/backup busybox tar czf /backup/marginalia-data-$(date +%F).tgz -C /data .
```

Then pull the new image and restart:

```sh
docker compose pull && docker compose up -d
```

Pending migrations run once at startup. To roll back, restore the backup and run the previous image tag:

```sh
docker compose exec -T db pg_restore -U marginalia -d marginalia --clean < marginalia-YYYY-MM-DD.dump
```

## Running a separate worker

Imports run inside the web container by default. To move them into their own container, run a second copy of the image with `MARGINALIA_ROLE=worker`, and set `MARGINALIA_ROLE=web` on the first. Both share `DATABASE_URL` and need the same `/data` and library mounts. Scheduled scans run once per interval across all workers.

## Health checks

`GET /api/health` is open without a login. It returns `200` when the database is reachable and `503` when it is not. The image's Docker `HEALTHCHECK` uses it.
