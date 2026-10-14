## 1. Dependencies and configuration

- [x] 1.1 Add pinned `ai`, `@ai-sdk/react`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, and `@ai-sdk/openai-compatible`; verify `pnpm typecheck` passes
- [x] 1.2 Extend `server/config.ts` with `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MAX_STEPS`, `AI_TEMPERATURE` and cross-field validation (D2); verify unit tests for no provider (valid), missing model, missing key, missing base URL for `openai-compatible`, and that the key never appears in error or log output
- [x] 1.3 Implement `modules/ai` provider factory returning a model or null plus a secret-free status; verify unit tests per provider mapping and the disabled case

## 2. Data model

- [x] 2.1 Define `conversations`, `conversation_editions` (per-edition `max_position`), and `messages` in `modules/conversation` (D3), generate the migration with `pnpm db:generate`, and verify it applies to a fresh database in an integration test
- [x] 2.2 Implement conversation repository functions (create with one or more editions, list by edition via the join table, get with messages, rename, delete, append message with next `seq`); verify integration tests including a two-edition conversation, edition deletion removing the join row and deleting only conversations left empty, and list ordering by recent activity

## 3. Retrieval tools

- [x] 3.1 Add an `editionIds` filter (with per-edition bounds) to `retrieval.search`, then implement `searchBooks`, `readPassage`, and `getOutline` tools scoped to the conversation's set of editions with server-applied per-edition bounds, result and count caps, and out-of-set rejection (D5); verify integration tests against a fixture edition for scoping, a two-edition conversation with distinct bounds, caps, superseded/removed/not-found results, and refusal of an out-of-set locator
- [x] 3.2 Export the tools factory from `modules/conversation/index.ts` and add a Biome boundary check that it imports retrieval only via its `index.ts`; verify `pnpm lint` passes

## 4. Prompt and citations

- [x] 4.1 Write the versioned system prompt (`PROMPT_VERSION`) covering evidence versus interpretation, the challenging stance, citation marker format, retrieve-before-claiming, and the soft no-unrequested-spoilers rule (D6-D9); verify a unit test that the built prompt contains each required instruction and the book title
- [x] 4.2 Implement the citation marker parser (tolerant attribute order, escaped quotes, malformed markers ignored); verify unit tests for valid, reordered, escaped, malformed, and multiple markers
- [x] 4.3 Implement citation verification via `retrieval.verifyQuote`, producing `verified`/`not_found`/`quote_mismatch`/`removed`/`not_in_conversation` records with the current locator, edition, and range; verify integration tests for a valid quote, curly-vs-straight quotes, a fabricated quote, an out-of-set locator, and a superseded locator after a reparse

## 5. Chat orchestration and endpoint

- [x] 5.1 Implement the chat orchestrator (`streamText`, `convertToModelMessages`, tools, step cap, persist user message first, persist assistant parts/model/finish reason/prompt version and verified citations on finish, partial save on abort) (D4); verify integration tests using the AI SDK mock model with a scripted tool call plus cited answer, an abort, and a provider error
- [x] 5.2 Add the `POST /api/chat` route behind the session middleware and origin check, returning 503 when AI is disabled, 404 for an unknown conversation, and 409 for a concurrent generation; verify integration tests for each status, that an unauthenticated request stores nothing and makes no model call, and that the response streams incrementally
- [x] 5.3 Set a provisional conversation title from the first user message; verify a test that it is set once and not overwritten after a rename
- [x] 5.4 Add server functions for conversation list, create, get, rename, delete, and AI status; verify integration tests for each, including that status never includes the key

## 6. UI

- [x] 6.1 Build the conversation list at `/books/$editionId/conversations` with create (one book), rename, delete confirmation, the whole-book spoiler notice, and setup guidance when AI is disabled; verify in the running app
- [x] 6.2 Build the chat view at `/c/$conversationId` with `useChat` (new-message-only transport), streaming text, stop button, inline errors with retry, provider/model label, and collapsible tool-activity rows; verify in the running app with a real provider or a local OpenAI-compatible endpoint that a reply streams and tool rows appear
- [x] 6.3 Render citation chips from stored verification results (verified chips link to `/p/<currentLocator>` with the range highlighted, unverified chips visibly flagged, malformed markers as plain text) and visually separate cited evidence from interpretation; verify with a conversation containing one verified and one fabricated citation
- [x] 6.4 Support the range highlight query parameter in the passage view; verify opening a verified citation link highlights the quoted text
- [x] 6.5 Add the conversations link and "start conversation" action to the book detail page, and update the book-deletion confirmation to mention conversations; verify in the running app

## 7. Documentation and acceptance

- [x] 7.1 Document every AI variable in `docs/deployment.md` and the README with hosted and local (Ollama-style) examples and the data-sharing statement; verify the existing docs test that every `config.ts` variable appears in the docs passes
- [x] 7.2 Add `.env.example` and `compose.yaml` pass-through for the AI variables (empty by default); verify `docker compose config` shows them and the app still starts with none set
- [x] 7.3 Run the full suite (`pnpm typecheck`, `pnpm lint`, `pnpm test`); verify all pass
- [x] 7.4 Manual end-to-end with a real provider on the fixture book: ask a scene question, a leading wrong-premise question, and a thesis question; confirm tool use, verified citations, labeled interpretation, pushback on the wrong premise, and that restart and reparse keep the conversation and citations intact
