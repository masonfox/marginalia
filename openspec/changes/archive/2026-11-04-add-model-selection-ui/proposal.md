## Why

The provider and model are fixed by environment variables today, and the environment only holds one provider with one API key. Changing the model for conversations or preprocessing means editing `.env` and restarting, adding a second provider is impossible, and preprocessing is limited to a model from the conversation provider. Readers should be able to set up their providers and pick defaults in the app, and override them where it matters: a stronger model for one hard conversation, or a cheaper one for one long book (issue #32).

## What Changes

- **Providers are configured in Settings, not the environment.** Each supported provider (OpenAI, Anthropic, Google, and one OpenAI-compatible endpoint) has one credentials slot in Settings: an API key and an optional base URL for hosted providers, and a base URL with an optional API key for the OpenAI-compatible endpoint. Several providers can be configured at once. Keys are write-only: after saving, the app only shows that a key is set and its last four characters. Saving checks the credentials against the provider's model listing. Changes apply to the next model call, in every process, without a restart.
- **Keys are encrypted at rest.** A new required `MARGINALIA_SECRET_KEY` encrypts stored API keys. The application refuses to start without it.
- **BREAKING:** `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, and `AI_PREPROCESS_MODEL` are removed and no longer read. No released image has used them, so there is no upgrade path or deprecation warning. Global tuning stays in the environment: `AI_MAX_STEPS`, `AI_TEMPERATURE`, `AI_EFFORT`, `AI_PROMPT_CACHE`, `AI_PRICES`, and `AI_PREPROCESS_AUTO`.
- A **Settings** page holds the provider credentials, the default chat model, and the default preprocessing model. Each default is a provider plus a model, chosen from the configured providers. The preprocessing default may use a different provider from the chat default, or follow the chat default (the initial state). There is no chat default until one is saved.
- Model pickers list the provider's models from its list-models API where it has one, cached briefly. They always accept a typed model id too, which local and OpenAI-compatible endpoints need.
- A conversation can pin its own provider and model, chosen when it is started or changed later from the conversation view. Every later turn uses it until it is changed or cleared. An unpinned conversation follows the current default.
- A preprocessing run can be started with a chosen provider and model from the book's preprocessing card. The default preprocessing model is preselected. Automatic runs use the default.
- Provider status reports which providers are available (names only) and the effective defaults. Conversation and preprocessing views show the model actually in effect.
- AI is "enabled" when at least one provider has stored credentials. With credentials but no chat default, chat shows guidance to choose a model in Settings instead of reporting that AI is unconfigured.

Non-goals: several connections of the same provider kind (for example two OpenAI-compatible endpoints); configuring providers through environment variables; key rotation for `MARGINALIA_SECRET_KEY`; requiring a password before credentials can be managed (an instance without `AUTH_PASSWORD` stays open by the operator's choice); per-message model switching; UI control of effort, temperature, prompt caching, max steps, or prices; per-user settings (the instance has a single shared login).

## Capabilities

### New Capabilities
- `ai-settings`: Provider credentials stored encrypted in the database and managed in Settings, the persisted AI defaults (chat and preprocessing model), the Settings page that edits them, and the model listing behind the pickers.

### Modified Capabilities
- `ai-providers`: Credentials come from Settings for several providers at once, not from environment variables. "AI enabled" means at least one provider has stored credentials. Status covers available providers and defaults. Prompt caching follows the provider of each call. The preprocessing model may come from any available provider.
- `literary-conversations`: A conversation can pin a provider and model. Each turn uses the conversation's model or the current default. A pinned model whose provider lost its credentials is reported, never silently replaced.
- `book-preprocessing`: A run can be started with a chosen provider and model. A queued or retried run keeps its model. Status shows the model of the current or last run.
- `self-hosting`: `MARGINALIA_SECRET_KEY` is required and documented, the AI provider variables are removed from the documentation and example files, and the documentation explains configuring providers in Settings and what backups contain.

## Impact

- **Config** (`src/server/config.ts`, `.env.example`, `compose.yaml`, `docs/deployment.md`): remove every AI credential and model variable, including the per-provider ones added earlier on this branch. Add the required `MARGINALIA_SECRET_KEY`. `AI_PREPROCESS_AUTO` no longer needs credentials at startup.
- **AI runtime** (`src/modules/ai`): a resolver that reads credentials from the database per call, builds (and caches by credentials) a model for any available `(provider, model)`, and registers decrypted keys for masking. A model-listing client per provider, cached per credentials.
- **Database**: new `ai_credentials` (one row per provider, key encrypted) and `ai_settings` (a single row of defaults) tables, nullable `ai_provider`/`ai_model` columns on `conversations`, `messages.provider`, and `preprocess_runs.provider`. The unreleased migration `0016` is regenerated to include them.
- **Server functions/routes**: provider credentials get/save/remove, settings get/update, list models, set conversation model, and the start-preprocess input. A new `/settings` route and a header link.
- **UI**: the Settings page (providers and defaults), a model picker component, a conversation model control, and a model choice on the preprocessing card.
- **Usage/pricing**: unchanged. Usage rows already record provider and model, and models without a price show cost as unknown.
- **Dependencies**: none new. Encryption uses `node:crypto`. Model listing uses `fetch` against each provider's REST endpoint.
