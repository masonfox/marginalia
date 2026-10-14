## Context

See proposal.md for motivation. The foundation provides `modules/retrieval` (`search` with optional `maxPosition`, `resolve` with context, `verifyQuote` that follows locator aliases), validated env config in `server/config.ts`, pg-boss jobs, instance-password sessions, and TanStack Start routes. Editions have stable locators of the form `<short_id>:v<n>:<spine>.<block>`. Module boundaries are enforced by Biome: other modules import only through `index.ts`.

Constraint: reader progress does not exist yet, so spoiler bounds cannot be enforced in this change.

**Terminology.** In this change "book" means an *edition*: one EPUB, identified by its content hash. There is no work or book entity above editions (the foundation chose identity by hash), so two EPUBs of the same novel are two unrelated editions, and two different novels are likewise two editions. Conversations are scoped to a set of editions, which is what cross-book discussion needs. Grouping editions into a work or a series is out of scope and belongs to a later change (likely alongside `add-library-providers`). Because stored data references editions only, such a layer could later resolve a work to a preferred edition before conversations are created, with no migration of data from this change. The multi-book picker, when it arrives, should warn when two selected editions share a normalized title and authors.

## Goals / Non-Goals

**Goals:**
- Streaming, persistent chat over a *set* of books (exactly one in the MVP) whose factual claims about the text are backed by tool retrieval and server-verified citations.
- Provider choice is configuration, not code.
- Citations survive reparses (they are stored as locator + quote and re-verified through aliases).
- A seam for `add-reading-progress` to apply a position bound without reworking conversations.

**Non-Goals:**
- Multi-book and series conversations in the UI (GitHub issue #1; the model supports them, see D3), message editing/branching, attachments, per-user provider settings, usage billing, and embeddings.

## Decisions

### D1. Modules

```
modules/ai/            provider factory: env -> LanguageModel | null (no DB)
modules/conversation/  tables (owns conversations, messages), prompts, tools, citation extraction/verification, chat orchestration
routes/api/chat.ts     streaming endpoint
fns/conversations.ts   list/create/rename/delete/get
```

`conversation` depends on `retrieval` and `ai` through their `index.ts` files only. It never writes catalog tables.

### D2. Vercel AI SDK and provider configuration

Use `ai` (v5+ style: `streamText`, `UIMessage`, `convertToModelMessages`, tool definitions with zod schemas) with `@ai-sdk/react` `useChat` on the client.

Config (all optional, zod-validated in `config.ts`):
- `AI_PROVIDER`: `openai` | `anthropic` | `google` | `openai-compatible`. Unset means AI disabled.
- `AI_MODEL`: required when a provider is set.
- `AI_API_KEY`: required except for `openai-compatible`, where it is optional.
- `AI_BASE_URL`: required for `openai-compatible`, optional override otherwise.
- `AI_MAX_STEPS` (default 8): tool-loop step cap.
- `AI_TEMPERATURE` (optional).

`modules/ai` maps these to a `LanguageModel` with a small switch. Misconfiguration (provider set without model, missing key or URL) fails startup with an error naming the variable and never echoing the key. With no provider, the app starts normally and a `GET`-able status function reports `{ enabled: false }`; the UI shows setup guidance instead of the chat box and the chat endpoint returns 503.

Alternatives: the AI SDK gateway string model IDs (adds an external hop and account for a self-hosted tool), rejected. A DB-stored provider settings UI, rejected for now because the instance has no per-user admin role and env keeps secrets out of the database.

### D3. Data model

```
conversations  id uuid, title, created_at, updated_at
conversation_editions
               conversation_id (FK CASCADE), edition_id (FK editions, ON DELETE CASCADE),
               ordinal int, max_position int NULL,
               PRIMARY KEY(conversation_id, edition_id)
messages       id uuid, conversation_id (FK CASCADE), seq int, role('user'|'assistant'),
               parts jsonb,            -- AI SDK UIMessage parts (text, tool calls/results)
               citations jsonb,        -- verified citation records, see D6
               finish_reason text, model text, error text NULL, created_at
               UNIQUE(conversation_id, seq)
```

`parts` stores the UIMessage parts verbatim so the conversation can be replayed to the model and rendered identically. **Scope is a set of editions, not a column.** GitHub issue #1 (cross-book and series support) calls for conversations spanning conceptually related books and whole series. A single `edition_id` on `conversations` would force a migration and a rewrite of tools, citations, and UI later, so the join table is used now. The MVP creates and displays exactly one row per conversation, and nothing else in the code assumes one: tools, prompt, citation checks, and lists all take "the conversation's editions". A future series feature only needs to expand a series into its editions when creating a conversation. Series as an entity is not modeled here (it belongs with library providers or its own change).

`max_position` is per edition (a reader is at a different place in each book), is always NULL in this change, and is passed to retrieval as that edition's `maxPosition` when non-null. This is the seam for `add-reading-progress`.

**Book deletion:** deleting an edition removes its `conversation_editions` rows. A conversation left with no editions is deleted (always the case in the MVP, so the delete-book confirmation says those conversations are deleted). A future multi-book conversation that loses one book stays, and its stored citations to that book render as "book no longer in library".

*Alternative:* one row per part, rejected as needless complexity.

### D4. Chat endpoint and streaming

`POST /api/chat` (file-route API handler, behind the existing session middleware and origin check) takes `{ conversationId, message }`. The server, not the client, owns history: it loads stored messages, appends the new user message (persisting it first), calls `streamText` with `convertToModelMessages`, and returns `toUIMessageStreamResponse`. In `onFinish`, it persists the assistant message (parts, model, finish reason) and runs citation verification (D6), saving results before the stream ends by appending a custom data part so the client receives verified citations live. Client disconnect: pass `abortSignal` from the request; on abort the partial assistant message is persisted with `finish_reason = 'aborted'`. A conversation accepts one in-flight generation; a concurrent request gets 409, enforced with a `pg_try_advisory_xact_lock`-style guard keyed on the conversation id held by an in-memory set (single process is acceptable, as with the login limiter).

The first user message also sets a provisional title (first 60 characters), which the reader can rename.

### D5. Retrieval as tools

Tools are scoped to the conversation's set of editions, so the model cannot reach a book outside it. Each edition has a short label (title plus a handle such as `b1`) given to the model in the system prompt.

- `searchBooks({ query, book?, limit? })`: wraps `retrieval.search`. `book` is optional and must be in the conversation's set; omitted means all of the conversation's editions (one in the MVP). The server applies each edition's own `maxPosition`. Retrieval gains an `editionIds` filter (a set of editions, each with an optional bound) instead of the caller looping, so ranking and limit stay correct across books. Results name the book; limit capped at 10; returns locator, section title, position, and plain snippet text.
- `readPassage({ locator, context? })`: wraps `retrieval.resolve`, context capped at 5; rejects locators whose edition is not in the conversation's set, and returns `superseded`/`removed`/`not_found` states as data the model can act on.
- `getOutline({ book? })`: returns the table of contents (section titles with first locator) so the model can navigate structure when search is not the right tool.

Tool results are bounded in size (character cap per call) and are stored in `parts`. The step cap is `AI_MAX_STEPS`. The system prompt instructs the model to retrieve before making claims about the text.

*Alternative:* retrieve-then-stuff the prompt (classic RAG), rejected because the model chooses better queries, can follow footnotes and context, and tool results are inspectable and citeable.

### D6. Verified citations

The model is instructed to cite inline using a fixed markup, e.g. `[[cite locator="3f9a…:v1:12.47" quote="exact words"]]`. After generation, the server parses all markers from the final text and verifies each via `retrieval.verifyQuote` (which follows aliases). Each becomes a record `{ editionId, locator, currentLocator, quote, status: 'verified'|'not_found'|'quote_mismatch'|'removed'|'not_in_conversation', range? }`.

- Locators from an edition outside the conversation's set are `not_in_conversation`. Each record also stores `editionId`, so multi-book citations render with the book name.
- Rendering: the client replaces markers with citation chips. Verified chips show the section title and link to `/p/<currentLocator>`, with the verified text range highlighted in the passage view via a query parameter. Unverified chips are rendered with a clear "could not verify" state and the quote is not styled as evidence.
- The stored `citations` column is the authority for the UI, so the verdict is computed once, server-side, and never relies on the model's own claim. When a conversation is reopened after a reparse, chips resolve through aliases at click time.
- Markers are parsed with a strict tolerant parser (attribute order, curly quotes inside the quote attribute escaped by the model as `\"`); malformed markers render as plain text with no chip.

*Alternatives:* provider-native citation APIs, rejected as not uniform across providers and not verifying against our own locators. Verifying only in the UI, rejected so the verdict is persisted and testable.

### D7. Evidence versus interpretation

Enforced by prompt and by presentation, not by parsing prose. The system prompt requires every substantive answer to separate (a) **Evidence**: what the text says, quoted and cited, and (b) **Interpretation**: what the assistant infers, explicitly labeled as such, with confidence and alternative readings where reasonable. Statements about the book with no retrieved support must be labeled as not found in the text rather than asserted. The UI renders citation chips as evidence a
Enforced by prompt and by presentation, not by parsing prose. The system prompt requires every substantive answer to separate (a) **Evidence**: what the text says, quoted and cited, and (b) **Interpretation**: what the assistant infers, explicitly labeled as such, with confidence and alternative readings where reasonable. Statements about the book with no retrieved support must be labeled as not found in the text rather than asserted. The UI renders citation chips as evidence. Because labeling is a model behavior, the design relies on evaluations (see Risks) rather than a guarantee, while citation validity (the mechanically checkable part) is guaranteed by D6.

### D8. Challenging stance

Part of the system prompt, versioned as a constant `PROMPT_VERSION` stored on each assistant message. It directs the model to: state its own reading rather than mirror the reader's; disagree and explain why when the evidence is weak; surface passages that complicate the reader's theory; ask a pointed follow-up question; avoid praise and filler; remain respectful and concede when the text supports the reader. It is also told that claims about the text must rest on retrieved passages, not on memory of the book or outside commentary, though general literary knowledge may be used if labeled as such.

### D9. Spoilers (interim)

Retrieval is unbounded because progress does not exist. The system prompt tells the model not to volunteer events the reader has not mentioned, as a soft courtesy and not a guarantee, and the new-conversation UI states plainly that the assistant may reveal the whole book. `conversation_editions.max_position` plus the server-applied per-edition bound in the tools (D5) is the hook for hard enforcement later.

### D10. UI

Routes: `/books/$editionId/conversations` (conversations containing that book, and create one with that book). The conversation view shows the books in scope, which is one for now and `/c/$conversationId` (chat). Chat uses `useChat` with a transport that posts to `/api/chat` and sends only the new message. Tool activity shows as collapsible "Searched for..." rows, with a stop button, inline errors, and retry for failed generations. Rename and delete live on the list and in the chat header, with a delete confirmation.

### D11. Tests

- Unit: prompt builder, citation marker parser, provider factory and config validation (secret redaction).
- Integration (Testcontainers): tools against a real fixture edition including bounds, out-of-set rejection, and a two-edition conversation (search across both with distinct bounds) even though the UI creates only single-book ones; conversation persistence; citation verification including superseded locators.
- Chat orchestration is tested with the AI SDK's mock language model and simulated streams (scripted tool calls and cited text), so no network or key is needed. A manual end-to-end check uses a real provider.

## Risks / Trade-offs

- [Model ignores the evidence/interpretation structure or the anti-sycophancy instruction] → The prompt is versioned and kept in one file. A small scripted evaluation set (fixture questions, assertions on cited-ness) is run manually against a real provider. Citation validity is mechanical regardless.
- [Hallucinated quotes] → Server verification flags them, and unverified chips look distinct.
- [Spoilers before progress exists] → Explicit UI warning, soft prompt guidance, and a seam for hard enforcement.
- [Book text and chat go to a third-party provider] → Documented clearly, and a local OpenAI-compatible endpoint is supported.
- [Cost and runaway tool loops] → Step cap, per-call result size caps, tool limits, one in-flight generation per conversation.
- [Tool-calling quality differs across providers, especially small local models] → Documented as best-effort. The verified-citation rule still applies.
- [AI SDK API churn] → Pin exact versions, as the repo already does.

## Migration Plan

One additive drizzle migration adds `conversations` and `messages`. AI is off unless configured, so existing deployments are unaffected on upgrade. Rollback is the previous image tag, leaving the unused tables in place.

## Open Questions

- Whether to add a per-conversation model override later (not needed for these specs).

## Decision record: provider configuration

Environment-only configuration is deliberate, not just a shortcut. A settings UI would need API keys stored in the database (so encryption at rest and key management), an admin concept (the instance has one shared password and no roles, so any reader could view or change the provider), and a way to apply changes without a restart. None of that pays off while most instances use a single provider. Environment variables also fit Compose and secret managers. `modules/ai` is the only consumer, so a later settings UI (or per-reader keys after `add-reading-progress`) would replace its input source without touching conversations.
