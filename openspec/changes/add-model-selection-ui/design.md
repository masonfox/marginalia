## Context

Before this change, `createAi(config.ai)` in `src/modules/ai/index.ts` built two fixed `LanguageModel`s at boot from a single-provider `AiConfig` (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, `AI_PREPROCESS_MODEL`). They lived on `appContext().ai`. Model calls happen in two places only:

- `src/modules/conversation/chat.ts`, which reads the model and its provider and model names.
- `src/server/jobs/handlers.ts` (`analysis.preprocess`), which passes the preprocessing model and its names into `preprocessEdition`.

`providerOptions` (Anthropic caching) was computed once for the single provider. Usage rows already store `provider` and `model`. `messages.model` and `preprocess_runs.model` already exist. The instance has one shared login (optional), so settings are instance-wide. The app can run as separate `web` and `worker` processes (`MARGINALIA_ROLE`) on one database. The requirements are in `specs/`, and the user's answers to the scoping questions are folded into proposal.md.

**Revision (2026-10-16).** The first version of this change kept credentials in the environment, with per-provider variables (`AI_ANTHROPIC_API_KEY` and so on) and the legacy `AI_PROVIDER` variables, and env model defaults that Settings could override. That was implemented on this branch (commits `e125200` onward) and is now reversed: credentials and defaults live only in Settings, and the AI credential and model variables are removed. No released image read those variables, so nothing needs migrating. Decisions 1, 3, 9, and 10 below describe the revised design. Tasks section 8 lists the rework.

## Goals / Non-Goals

**Goals:**
- Every model call resolves `(provider, model)` and that provider's credentials at call time, so Settings changes apply without a restart, in every process.
- Keep one code path for building models and provider options, whatever the source of the selection.
- API keys are never returned to the browser and never stored in plaintext.

**Non-Goals:**
- Several connections of one provider kind. Each kind has one credentials slot.
- Per-provider effort, temperature, max steps, or caching. These stay global env settings applied to every call.
- Validating that a typed model id exists before a call. A bad id surfaces as the provider's error on first use, through the existing masked error path.
- Rotating `MARGINALIA_SECRET_KEY`. Changing it makes stored keys unreadable; they must be entered again.
- Live updates of Settings across open browser tabs. A page reload picks up changes.

## Decisions

### 1. Credentials stored in the database, one slot per provider

A new `ai_credentials` table has one row per provider: `provider` (primary key, checked against the four provider names), `api_key_ciphertext`, `api_key_iv`, `api_key_tag` (bytea, all null or all set), `api_key_hint` (the last four characters, for display), `base_url` (nullable text), `secret_key_id` (which `MARGINALIA_SECRET_KEY` encrypted the key), and `updated_at`. A provider is available when its row has what the provider needs: an API key for hosted providers, a base URL for the OpenAI-compatible endpoint, and a key that decrypts with the current secret key.

`src/modules/settings` exposes `listProviderCredentials(db)` (provider, configured, `apiKeyHint`, `baseUrl`, and `unreadable` when the key was encrypted with another secret, never the key), `saveProviderCredentials(db, input)`, `removeProviderCredentials(db, provider)`, and an internal `loadCredentials(db)` that decrypts for the AI runtime only.

`config.ts` drops every AI credential and model variable (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, `AI_PREPROCESS_MODEL`, and the per-provider `AI_<KIND>_API_KEY`/`_BASE_URL` added earlier). They are no longer read and get no warning. `config.ai` keeps the global settings (`maxSteps`, `temperature`, `effort`, `promptCache`, `prices`, `preprocessAuto`), and `ai` is always defined. "AI disabled" is now a runtime fact, "no available provider", not a config fact.

*Alternatives:* env credentials with Settings defaults only (the first version of this change), rejected because the env model is static and awkward to extend. Named connections allowing several endpoints of one kind, rejected for now: it would change selections from `(provider, model)` to `(connectionId, model)` across the schema, and one slot per kind covers the current need.

### 2. `AiRuntime` becomes an async resolver

Replace `model`/`preprocessModel` with:

- `available(): Promise<AiProviderName[]>`, from `loadCredentials`.
- `resolve(sel: Selection): Promise<{ ok: true, model, providerOptions, selection } | { ok: false, reason: "unavailable" }>`, which builds the model with that provider's current credentials.
- `buildProviderOptions(provider)`, a function of the call's provider. It returns `anthropic.cacheControl` only for Anthropic when `promptCache` is on.

Credentials are read from the database on each resolve: one small-table select and an AES-GCM decrypt, which is negligible next to a model call, and it keeps the web and worker processes consistent with no signalling. Provider factories (`createAnthropic({...})`) are memoized in a map keyed by provider plus a SHA-256 fingerprint of the credentials, so a changed key or base URL gets a new factory and the old entry is never used again. Every decrypted key passes through `registerSecret` before use, so masking covers keys added after boot. A removed key stays registered for the process lifetime, which is harmless.

*Alternative:* rebuild the runtime when settings change. Rejected because a runtime-wide swap during a streaming turn is racy, and it would need cross-process notification.

### 3. Default storage and resolution

There is a new `ai_settings` table: a single row (`id smallint primary key check (id = 1)`) with nullable `chat_provider`, `chat_model`, `preprocess_mode` (`'same-as-chat' | 'model' | null`, where null means same-as-chat), `preprocess_provider`, `preprocess_model`, and `updated_at`. `src/modules/settings` exposes `getAiDefaults(db, available)`, which returns each effective default with `available`, plus `saveChatDefault`, `savePreprocessDefault`, `clearChatDefault`, and `clearPreprocessDefault` (back to same-as-chat).

There are no environment defaults. A fresh instance has no chat default, and the preprocessing default is "same as chat".

Resolution order:

- **Chat turn:** `conversation.ai_provider/ai_model` → chat default → none.
- **Preprocess enqueue:** explicit choice → saved preprocessing model, or the chat default when it is same-as-chat → none.

The settings row is read once per call; it is a single primary-key lookup. There is no in-process cache, so several app processes on one database stay consistent.

*Alternative:* a generic key/value `settings` table (`instance_settings` already exists for the password hash). Rejected because typed columns get constraint checks.

### 4. Conversation override columns

Add nullable `ai_provider` and `ai_model` to `conversations`, with a check that both are null or both are set. Add `provider` to `messages`, next to `model`, for reply provenance. Usage rows already carry it. A new server function `setConversationModelFn({ conversationId, selection | null })` validates the selection (provider available, model id rules) and refuses while `inFlight` holds the conversation. `createConversationFn` accepts an optional selection. `startChat` resolves the model before persisting the user message, so an unavailable model returns a new `{ status: "model_unavailable", selection }` and nothing is stored. `/api/chat` maps it to 503 with a body naming the model, like the existing "disabled" case. The system prompt and tools are untouched, so changing the model only costs a cache miss on the next turn.

### 5. Preprocessing selection travels in the job payload

The `analysis.preprocess` payload becomes `{ editionId, provider, model }`. Resolution happens in `startPreprocessFn` and in `maybeAutoPreprocess` at enqueue time. When automatic preprocessing is on and no default resolves, the trigger skips with a warning; `AI_PREPROCESS_AUTO` no longer requires credentials at startup, since credentials arrive at runtime. The handler calls `ai.resolve(payload)`. If the result is unavailable, it fails the run with `lastError` "Model <provider>/<model> is unavailable" and throws a non-retryable error. A payload without `provider`/`model` (from a dev database queued before this change) falls back to the current preprocessing default. `preprocess_runs` gains a `provider` column, and the handler sets `provider`/`model` when it claims the run. Deduplication stays keyed on `editionId` (the queue's singleton key). When `enqueue` returns null, the start function reads the pending run and reports its model.

### 6. Model listing

`src/modules/ai/models.ts` exposes `listModels(provider, credentials, signal)` using plain `fetch`:

- **OpenAI:** `GET {base}/v1/models`
- **Anthropic:** `GET {base}/v1/models` with `x-api-key` and `anthropic-version`, paginated by `after_id`, capped at a few pages
- **Google:** `GET {base}/v1beta/models?key=…`, filtered to `supportedGenerationMethods` containing `generateContent`
- **OpenAI-compatible:** `GET {base}/models`

Each request has a short timeout (around 5 s). Results are cached in memory for 10 minutes per provider and credentials fingerprint (Decision 2), so a changed key never serves the old key's list, and a `refresh` flag bypasses the cache. Errors go through `describeError`/`maskSecrets` and are returned as `{ models: [], error }`, never thrown to the client. Each entry includes `price` from `priceTable` when one is known. The Google key travels in the query string, so it must never be logged with the URL. `fetch` errors are masked through the registered-secret path.

*Alternative:* the AI SDK has no cross-provider list-models API, and adding provider SDKs only for listing is unnecessary weight.

### 7. UI

- **`/settings` route** (`src/routes/settings.tsx`), with a header link next to "Log out". It has three sections:
  - **Providers.** One row per provider kind: configured or not, the key hint ("set · ends in a3f9"), the base URL, and Add, Replace key, Edit base URL, and Remove actions. A key is entered in a password field and is never pre-filled. An unreadable key (encrypted with another secret) is flagged with a prompt to enter it again.
  - **Chat default** and **Preprocessing default**, each with a `ModelPicker`, an unavailable warning, and a clear action (preprocessing clears to same-as-chat).
  - When no provider is configured, the default sections are replaced by a prompt to add a provider above.
- **`ModelPicker` component** (`src/components/model-picker.tsx`): a provider select limited to available providers, then a combobox over the listed models, with a free-text entry, a refresh button, and a "not in provider list" notice. It is reused by Settings, the conversation model control, and the preprocessing card.
- **Conversation view:** a compact control in the header line. It shows the effective model and "default"/"this conversation" and opens the picker with a "Use default" option. It is disabled while streaming.
- **Preprocessing card:** a "Model" row with the default preselected and a change link that opens the picker. The chosen selection is passed to `startPreprocessFn`.

### 8. Validation shared between client and server

A zod `selectionSchema` (`{ provider: enum, model: string.trim().min(1).max(200).regex(no control chars) }`) lives in `src/modules/ai` and is used by every server function. The "provider available" check is server-side only. A `credentialsInputSchema` validates the save input: `apiKey` trimmed, 1–500 characters, no whitespace or control characters; `baseUrl` an absolute http(s) URL with no user-info (`user:pass@`), no query or fragment, trailing slashes removed.

### 9. Encryption with `MARGINALIA_SECRET_KEY`

`MARGINALIA_SECRET_KEY` is required at startup, whatever else is configured. It must decode from base64 to at least 32 bytes (the docs suggest `openssl rand -base64 32`), and startup fails naming the variable otherwise. It is registered as a secret and redacted from config logs. The encryption key is derived with HKDF-SHA256 (`info: "marginalia ai-credentials v1"`). API keys are encrypted with AES-256-GCM using a random 12-byte IV per write, and the provider name is the additional authenticated data, so a ciphertext cannot be moved to another provider's row. `secret_key_id` is the first 8 bytes of an HMAC of a fixed label under the derived key. A row whose `secret_key_id` differs from the current one, or whose tag fails, is reported as `unreadable` and treated as unavailable; it is never decrypted with a guess and never causes a startup failure.

*Alternatives:* plaintext (backups and dumps would hold live keys); a generated key file in the data volume (it only protects SQL dumps, not volume copies, and adds a file to back up). Encrypting only when the secret is set was rejected in favour of one code path.

### 10. Saving and removing credentials

`saveProviderCredentialsFn({ provider, apiKey?, baseUrl?, skipCheck? })`:

- Requires the inputs the provider needs after the save: a key for hosted providers, a base URL for OpenAI-compatible. An omitted `apiKey` keeps the stored key.
- Changing the base URL of a provider that has a stored key requires `apiKey` in the same request. Otherwise one edit could send a stored key to another server.
- Before writing, it runs `listModels` with the candidate credentials and `refresh`. An authentication failure (HTTP 401/403) is refused with the masked provider message. Any other failure (unreachable, no listing endpoint, timeout) is refused with the masked error unless `skipCheck` is set, which the UI offers as "Save anyway".
- Writes in one upsert, then clears that provider's model-list cache entries.

The response and every read return only `configured`, `apiKeyHint`, `baseUrl`, and `unreadable`. `removeProviderCredentialsFn(provider)` deletes the row. Saved defaults and conversation selections that name the provider are kept and reported unavailable, as the specs require.

## Risks / Trade-offs

- **[Anyone who can reach an instance without `AUTH_PASSWORD` can add, replace, or remove keys]** → This matches the existing trust model, where the operator chooses whether to set a password. Keys are write-only, so they cannot be read back through the app, and the base-URL rule stops a stored key from being redirected. The documentation states this.
- **[Base URLs are fetched server-side]** → An OpenAI-compatible endpoint is normally on the local network, so private addresses cannot be blocked. User-info, query, and fragment are rejected, and a key always goes only to the base URL it was saved with. Accepted under the same trust model.
- **[Losing `MARGINALIA_SECRET_KEY`]** → Stored keys become unreadable, and Settings asks for them again. Nothing else is lost. The documentation says to back the secret up with the database.
- **[Typed model ids fail late]** → The picker warns when an id is not in the list, and provider errors already surface masked in chat and in the run's `lastError`.
- **[Several keys widen the masking surface]** → Every decrypted key is registered as a secret before use. Tests assert that no key appears in listing errors, status, settings responses, or logs.
- **[A database read per model call]** → One primary-key select and one small table scan per call, against a model call that takes seconds.
- **[Mixed-model preprocessing output]** → Units already record their model, and the spec makes resume-with-another-model explicit. Status shows the last run's model.

## Migration Plan

1. Migration `0016` has not been released, so it is regenerated to add `ai_credentials`, `ai_settings`, `conversations.ai_provider`/`ai_model` with the both-or-neither check, `messages.provider`, and `preprocess_runs.provider`. Developers who applied the earlier `0016` reset their dev database. All new columns are nullable, so the migration is additive and safe under the existing automatic-migration rules.
2. Deploy with `MARGINALIA_SECRET_KEY` set. AI is disabled until a provider is added in Settings and a chat default is chosen.
3. Rollback: the previous image ignores the new tables and columns. Jobs enqueued with the new payload shape still carry `editionId`, which the old handler reads.
