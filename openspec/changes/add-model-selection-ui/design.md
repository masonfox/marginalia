## Context

Today `createAi(config.ai)` in `src/modules/ai/index.ts` builds two fixed `LanguageModel`s at boot from a single-provider `AiConfig` (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, `AI_PREPROCESS_MODEL`). They live on `appContext().ai`. Model calls happen in two places only:

- `src/modules/conversation/chat.ts`, which reads `ai.model`, `ai.status.model`, and `ai.status.provider`.
- `src/server/jobs/handlers.ts` (`analysis.preprocess`), which passes `ai.preprocessModel` and its names into `preprocessEdition`.

`providerOptions` (Anthropic caching) is computed once for the single provider. Usage rows already store `provider` and `model`. `messages.model` and `preprocess_runs.model` already exist. The instance has one shared login, so settings are instance-wide. The requirements are in `specs/`, and the user's answers to the scoping questions are folded into proposal.md.

## Goals / Non-Goals

**Goals:**
- Every model call resolves `(provider, model)` at call time, so Settings changes apply without a restart.
- Keep one code path for building models and provider options, whatever the source of the selection.
- Upgrading needs no operator action: an env-only deployment resolves to the same models as before.

**Non-Goals:**
- Per-provider effort, temperature, max steps, or caching. These stay global env settings applied to every call.
- Validating that a typed model id exists before a call. A bad id surfaces as the provider's error on first use, through the existing masked error path.
- Live updates of Settings across open browser tabs. A page reload picks up changes.

## Decisions

### 1. Credentials registry built from env at boot

`config.ts` produces `ai: { credentials: Partial<Record<AiProviderName, { apiKey?, baseUrl? }>>, envDefaults: { chat?: Selection, preprocess?: Selection }, maxSteps, temperature, effort, promptCache, prices }`. The legacy `AI_PROVIDER`/`AI_API_KEY`/`AI_BASE_URL` fill the credentials entry for `AI_PROVIDER`. `AI_PROVIDER` + `AI_MODEL` give `envDefaults.chat`, and `AI_PROVIDER` + `AI_PREPROCESS_MODEL` give `envDefaults.preprocess`. Supplying the same provider's credentials through both the legacy and the per-provider variables is a startup error, which avoids a silent precedence rule between two keys. Every key goes through `registerSecret`, so masking covers all providers. `redactConfig` reports `apiKeySet` per provider.

*Alternative:* a single JSON variable listing providers. Rejected because it is harder to write in Compose and in `.env`, and the existing variables are flat.

`ai` stays defined when no provider has credentials. "Disabled" becomes `Object.keys(credentials).length === 0` instead of `ai === undefined`. Callers that check `config.ai?.prices` keep working.

### 2. `AiRuntime` becomes a resolver

Replace `model`/`preprocessModel` with:

- `available(): AiProviderName[]`
- `resolve(sel: Selection): { ok: true, model, providerOptions, selection } | { ok: false, reason: "unavailable" }`, which builds the model with that provider's credentials. Provider factories (`createAnthropic({...})`) are memoized per provider. Model instances are cheap, so they are created per call.
- `buildProviderOptions(provider)`, which is now a function of the call's provider. It returns `anthropic.cacheControl` only for Anthropic when `promptCache` is on.

`status` becomes a function, because defaults now live in the database (see Decision 3).

*Alternative:* rebuild the runtime when settings change. Rejected because a runtime-wide swap during a streaming turn is racy, while resolving per call is not.

### 3. Settings storage and resolution

There is a new `ai_settings` table: a single row (`id smallint primary key check (id = 1)`) with nullable `chat_provider`, `chat_model`, `preprocess_mode` (`'same-as-chat' | 'model' | null`), `preprocess_provider`, `preprocess_model`, and `updated_at`. A null column means "not saved, use env" (see the spec's environment-defaults requirement). A new module `src/modules/settings` exposes `getAiDefaults(db, envDefaults)`. It returns each effective default with `source: "settings" | "env" | "none"` and `available` (from `ai.available()`). It also exposes `saveChatDefault`, `savePreprocessDefault`, and `resetChatDefault`/`resetPreprocessDefault`.

Resolution order:

- **Chat turn:** `conversation.ai_provider/ai_model` → saved chat default → env chat default → none.
- **Preprocess enqueue:** explicit choice → saved preprocessing default (`same-as-chat` resolves through the chat chain) → env preprocess default → chat chain.

The settings row is read once per call; it is a single primary-key lookup. There is no in-process cache, so several app instances on one database stay consistent.

*Alternative:* a generic key/value `settings` table. Rejected for now because typed columns get constraint checks. A later generic table can absorb this.

### 4. Conversation override columns

Add nullable `ai_provider` and `ai_model` to `conversations`, with a check that both are null or both are set. Add `provider` to `messages`, next to `model`, for reply provenance. Usage rows already carry it. A new server function `setConversationModelFn({ conversationId, selection | null })` validates the selection (provider available, model id rules) and refuses while `inFlight` holds the conversation. `createConversationFn` accepts an optional selection. `startChat` resolves the model before persisting the user message, so an unavailable model returns a new `{ status: "model_unavailable", selection }` and nothing is stored. `/api/chat` maps it to 503 with a body naming the model, like the existing "disabled" case. The system prompt and tools are untouched, so changing the model only costs a cache miss on the next turn.

### 5. Preprocessing selection travels in the job payload

The `analysis.preprocess` payload becomes `{ editionId, provider, model }`. Resolution happens in `startPreprocessFn` and in `maybeAutoPreprocess` at enqueue time. The handler calls `ai.resolve(payload)`. If the result is unavailable, it fails the run with `lastError` "Model <provider>/<model> is unavailable" and throws a non-retryable error. A job queued before this change has a payload without `provider`/`model`, so the handler falls back to resolving the current preprocessing default. `preprocess_runs` gains a `provider` column, and the handler sets `provider`/`model` when it claims the run. Deduplication stays keyed on `editionId` (the queue's singleton key). When `enqueue` returns null, the start function reads the pending run and reports its model.

### 6. Model listing

`src/modules/ai/models.ts` exposes `listModels(provider, credentials, signal)` using plain `fetch`:

- **OpenAI:** `GET {base}/v1/models`
- **Anthropic:** `GET {base}/v1/models` with `x-api-key` and `anthropic-version`, paginated by `after_id`, capped at a few pages
- **Google:** `GET {base}/v1beta/models?key=…`, filtered to `supportedGenerationMethods` containing `generateContent`
- **OpenAI-compatible:** `GET {base}/models`

Each request has a short timeout (around 5 s). Results are cached in memory per provider for 10 minutes, and a `refresh` flag bypasses the cache. Errors go through `describeError`/`maskSecrets` and are returned as `{ models: [], error }`, never thrown to the client. Each entry includes `price` from `priceTable` when one is known. The Google key travels in the query string, so it must never be logged with the URL. `fetch` errors are masked through the registered-secret path.

*Alternative:* the AI SDK has no cross-provider list-models API, and adding provider SDKs only for listing is unnecessary weight.

### 7. UI

- **`/settings` route** (`src/routes/settings.tsx`), with a header link next to "Log out". It has two cards (Chat default, Preprocessing default), each showing the source badge, an unavailable warning, a reset button, and a `ModelPicker`.
- **`ModelPicker` component** (`src/components/model-picker.tsx`): a provider select limited to available providers, then a combobox over the listed models, with a free-text entry, a refresh button, and a "not in provider list" notice. It is reused by Settings, the conversation model control, and the preprocessing card.
- **Conversation view:** a compact control in the header line that today renders `· {ai.provider} · {ai.model}`. It shows the effective model and "default"/"this conversation" and opens the picker with a "Use default" option. It is disabled while streaming.
- **Preprocessing card:** a "Model" row with the default preselected and a change link that opens the picker. The chosen selection is passed to `startPreprocessFn`.

### 8. Validation shared between client and server

A zod `selectionSchema` (`{ provider: enum, model: string.trim().min(1).max(200).regex(no control chars) }`) lives in `src/modules/ai` and is used by every server function. The "provider available" check is server-side only.

## Risks / Trade-offs

- **[Typed model ids fail late]** → The picker warns when an id is not in the list, and provider errors already surface masked in chat and in the run's `lastError`.
- **[Several keys widen the masking surface]** → Every key is registered as a secret at boot. Listing errors and the Google query-string key go through the same masking. Tests assert that no key appears in listing errors or status.
- **[Mixed-model preprocessing output]** → Units already record their model, and the spec makes resume-with-another-model explicit. Status shows the last run's model.
- **[Old queued jobs without a selection]** → The handler falls back to the current default (Decision 5).
- **[Unpriced models from listings]** → They show cost as unknown, as today, and operators can add prices through `AI_PRICES`.
- **[Anyone with the shared password can change instance defaults]** → This matches the existing trust model (any reader can delete books and start preprocessing). It is documented.

## Migration Plan

1. One Drizzle migration adds `ai_settings`, `conversations.ai_provider`/`ai_model` with the both-or-neither check, `messages.provider`, and `preprocess_runs.provider`. All are nullable, so the migration is additive and safe under the existing automatic-migration rules.
2. Deploy. With no saved settings, resolution falls back to the env defaults (Decision 3), so behavior is unchanged.
3. Rollback: the previous image ignores the new columns and table. Jobs enqueued with the new payload shape still carry `editionId`, which the old handler reads.
