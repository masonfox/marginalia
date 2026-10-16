## 1. Configuration

- [x] 1.1 Add per-provider credential variables (`AI_{OPENAI,ANTHROPIC,GOOGLE}_API_KEY`/`_BASE_URL`, `AI_OPENAI_COMPATIBLE_BASE_URL`/`_API_KEY`) to the env schema in `src/server/config.ts`, and reshape `AiConfig` into `credentials`, `envDefaults.chat`/`envDefaults.preprocess`, and the global settings (design Decision 1). Verify with `config.test.ts` cases for each provider, legacy `AI_PROVIDER` mapping, and an env-only config that yields the same defaults as today.
- [x] 1.2 Implement the cross-field validation from the ai-providers spec: duplicate legacy and per-provider credentials, a base URL without a key, an invalid URL, `AI_PREPROCESS_MODEL` without `AI_PROVIDER`, and warnings (not errors) for `AI_MODEL`/`AI_API_KEY`/`AI_BASE_URL` without `AI_PROVIDER`. Verify with tests asserting each message names its variables and contains no key value.
- [x] 1.3 Update `redactConfig` to report `apiKeySet` per provider, and make `AI_PREPROCESS_AUTO` require at least one available provider. Verify with config tests.

## 2. AI runtime

- [x] 2.1 Add the shared zod `selectionSchema` (trimmed, 1–200 chars, no control characters) to `src/modules/ai`. Verify with unit tests for blank, too-long, and control-character ids.
- [x] 2.2 Replace the fixed models in `createAi` with `available()`, `resolve(selection)` (memoized provider factories, per-provider credentials), and a per-provider `buildProviderOptions`. Register every key with `registerSecret`. Verify in `ai.test.ts` that two providers resolve with their own keys, that an unavailable provider returns `unavailable`, and that only Anthropic selections get `cacheControl` (and none when caching is off).
- [x] 2.3 Implement `listModels` in `src/modules/ai/models.ts` for OpenAI, Anthropic (paginated), Google (filtered to `generateContent`), and OpenAI-compatible, with a timeout, a 10-minute per-provider cache, `refresh`, masked errors returned as `{ models: [], error }`, and per-model prices from `priceTable`. Verify with unit tests over a mocked `fetch`, including an error body that echoes the key and comes back masked.

## 3. Settings storage

- [x] 3.1 Add the Drizzle schema for `ai_settings` (single row), `conversations.ai_provider`/`ai_model` with a both-or-neither check, `messages.provider`, and `preprocess_runs.provider`. Generate the migration with `pnpm db:generate`. Verify that `pnpm db:migrate` applies it on a fresh and on an existing dev database, and that `db.int.test.ts` passes.
- [x] 3.2 Create `src/modules/settings` with `getAiDefaults` (effective value, `source`, `available`), `saveChatDefault`, `savePreprocessDefault` (selection or same-as-chat), and the two reset functions, following the resolution order in design Decision 3. Verify with an integration test covering env-only, saved-wins, reset-to-env, same-as-chat following a chat change, and a saved default whose provider is unavailable.
- [x] 3.3 Replace `getAiStatusFn` with a status that reports enabled, available providers, and both defaults with source and availability, and never keys or base URLs. Verify with an integration test asserting no credential fields appear in the response.

## 4. Conversations

- [x] 4.1 Make `startChat` resolve the model per turn (conversation override → defaults), return `model_unavailable` or `disabled` before persisting anything, and record `provider` and `model` on the assistant message and on usage. Map `model_unavailable` to a 503 naming the model in `/api/chat`. Verify with `service.int.test.ts` cases: override used, default followed after a change, unavailable override refused with nothing stored, and a retry using the model in effect when it starts.
- [x] 4.2 Add `setConversationModelFn` (set or clear; refuses while a reply is in flight) and an optional selection on `createConversationFn`. Verify with integration tests for set, clear, an unavailable provider rejected, and the busy refusal.
- [x] 4.3 Add a test asserting that the system prompt, tool definitions, and replayed history are byte-identical before and after a model change (stable-prefix requirement). Verify that it passes.

## 5. Preprocessing

- [x] 5.1 Change the `analysis.preprocess` payload to `{ editionId, provider, model }`. Resolve the selection in `startPreprocessFn` (explicit choice or default) and in the auto-trigger (skip with a warning when unresolvable), and report the pending run's model when the job is deduplicated. Verify with `handlers.int.test.ts` cases for an explicit choice, the default, the dedupe response, and an auto-trigger with no resolvable default.
- [x] 5.2 In the handler, resolve the payload selection (falling back to the current default for legacy payloads), record `provider`/`model` on the run, and fail without retry with an "unavailable" `lastError` when the provider has no credentials. Verify with tests for a retry keeping the original model, a legacy payload, and an unavailable provider.
- [x] 5.3 Extend `getPreprocessStatusFn` with the run's provider and model and the default a new run would preselect. Verify with an integration test where the last run's model differs from the default.

## 6. UI

- [x] 6.1 Build `src/components/model-picker.tsx` (provider select limited to available providers, a model combobox from `listModelsFn` with a free-text entry, refresh, a "not in provider list" notice, an unavailable/error state, and price or "unknown"). Add a server function `listModelsFn`. Verify with component unit tests for free-text entry, the listing-error state, and the unlisted-model notice.
- [x] 6.2 Add the `/settings` route and header link: chat and preprocessing cards with source badge, unavailable warning, reset, same-as-chat option for preprocessing, and setup guidance when no provider is available. Verify by running the app with `pnpm dev`, saving and resetting each default, and confirming the badges change.
- [x] 6.3 Add the conversation model control in the conversation header (effective model, "default" or "this conversation", "Use default", disabled while streaming), the model choice at conversation creation, the unavailable-model notice in place of the composer, and the producing model in each reply's usage details. Verify in the running app by switching models mid-conversation and checking that the next reply's usage names the new model.
- [x] 6.4 Add the model row with the preselected default and a change control to `preprocess-card.tsx`, showing the run's model and the default separately. Verify with `preprocess-card.test.ts` and by starting a run with a non-default model in the running app.
- [x] 6.5 Update the setup guidance shown when AI is disabled, or when no default is set, to point to the env variables and to Settings respectively. Verify with `chat.test.ts`.

## 7. Documentation and end-to-end

- [ ] 7.1 Update `.env.example`, `compose.yaml`, and `docs/deployment.md` with the per-provider variables, the legacy mapping, Settings precedence and reset, per-conversation and per-run models, and the shared-login note. Verify that `docs.test.ts` passes and that Compose passes `AI_OPENAI_API_KEY` through.
- [ ] 7.2 Add a Playwright e2e test that opens Settings, changes the chat default, and sees it shown in a new conversation (AI calls stubbed or disabled as in existing e2e). Verify that `pnpm test:e2e` passes.
- [ ] 7.3 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`, and confirm all pass.
