# Marginalia

**A spoiler-safe reading companion for your own ebooks.**

Discuss a book you're halfway through with an AI that only knows what you've read so far, quotes the actual text, and tells you when your reading doesn't hold up.

## Why not just ask a chatbot?

General-purpose chatbots make poor book-club partners:

- **They spoil things.** They've absorbed summaries of the whole book, and they don't know where you are in it.
- **They misquote.** Quotes are often paraphrased, merged, or made up.
- **They agree with you.** Suggest a theory and they'll usually find it insightful.

Marginalia is built around those problems:

- **It only sees what you've read.** You choose how far each conversation can go, and search enforces that limit on the server, so text past your point never reaches the model. The model is also told not to use outside knowledge of later events, but that part depends on the model following its instructions, so a very well-known book can still leak through what the model already knows.
- **Every quote is checked.** The assistant cites specific passages, and the server checks each quote against your copy of the book. Any it can't verify are flagged. Quotes from the book are always visibly separate from the assistant's own interpretation.
- **It disagrees when the text does.** Suggest a theory and it looks for evidence on both sides. When the book doesn't support your reading, it says so and points to the passages that cut against it.

## Who it's for

Readers who keep their own ebook library, would rather self-host than upload books to a service, and want a thinking partner for long, dense, or re-read-worthy fiction.

Marginalia has one shared password and no per-reader profiles, so it fits a single reader, or a household reading at the same pace, best. Everyone who signs in shares the same reading position and notes. See [Sharing an instance](docs/deployment.md#sharing-an-instance).

## What you get

- **Library.** Import EPUB files (EPUB 2 and 3) by upload, or point Marginalia at a folder it scans read-only. Search by title or author, and filter by Not started, Reading, Finished, or Needs attention.
- **Conversations.** Bring your own model: OpenAI, Anthropic, Google, or a local OpenAI-compatible endpoint such as Ollama, added in Settings. Each conversation is limited to the part of the book you choose, and each reply shows what it searched, what it cited, and an estimated cost. Passages and messages go to the provider you configure. See [AI conversations](docs/deployment.md#ai-conversations).
- **Book Guide.** Chapter summaries with linked citations, an index of characters, places, objects, and motifs, and your own Markdown notes, all hidden past your reading position. Correct or hide anything the AI got wrong, and see characters and places as glosses in the margin while you read. See [Book Guide and reading position](docs/deployment.md#book-guide-and-reading-position).
- **Reader and search.** Read any passage, and search within a book with language-aware full-text search and highlighted snippets.
- **Self-hosted.** One container plus PostgreSQL, for `amd64` and `arm64`, with optional password login. The library, reader, and search work with no AI provider at all.

## Quick start

```sh
cp .env.example .env    # set MARGINALIA_SECRET_KEY, AUTH_PASSWORD, POSTGRES_PASSWORD, and MARGINALIA_LIBRARY_DIR
docker compose up -d    # then open http://localhost:3000
```

Generate `MARGINALIA_SECRET_KEY` with `openssl rand -base64 32`, then add an AI provider in **Settings** once the app is running.

Without `AUTH_PASSWORD`, anyone who can reach the instance can use it. Only do that on a trusted network or behind an authenticating proxy. Serve Marginalia over HTTPS whenever it is reachable from beyond a trusted network.

See **[docs/deployment.md](docs/deployment.md)** for every configuration variable, volumes, external PostgreSQL, reverse proxies with HTTPS, and upgrades.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, commands, and code layout.
