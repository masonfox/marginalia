## Why

The provider and model are fixed by environment variables today, so changing the model for conversations or preprocessing means editing `.env` and restarting. Preprocessing is also limited to a model from the conversation provider. Readers should be able to pick defaults in the app and override them where it matters: a stronger model for one hard conversation, or a cheaper one for one long book (issue #32).

## What Changes

- Credentials stay in the environment, but several providers can be configured at once, each with its own key and base URL (`AI_ANTHROPIC_API_KEY`, `AI_OPENAI_API_KEY`, `AI_GOOGLE_API_KEY`, `AI_OPENAI_COMPATIBLE_BASE_URL`, and so on). The existing `AI_PROVIDER`/`AI_API_KEY`/`AI_BASE_URL` keep working as the credentials for one provider. API keys are never stored in the database or entered in the UI.
- A new **Settings** page sets the default chat model and the default preprocessing model. Each is a provider plus a model, chosen from the providers that have credentials. The preprocessing default may use a different provider from the chat default, or follow the chat default.
- Environment values (`AI_PROVIDER` + `AI_MODEL`, `AI_PREPROCESS_MODEL`) are the defaults until a choice is saved in Settings. A saved choice wins, and "reset" goes back to the environment default. Existing deployments behave the same with no action.
- Model pickers list the provider's models from its list-models API where it has one, cached briefly. They always accept a typed model id too, which local and OpenAI-compatible endpoints need.
- A conversation can pin its own provider and model, chosen when it is started or changed later from the conversation view. Every later turn uses it until it is changed or cleared. An unpinned conversation follows the current default.
- A preprocessing run can be started with a chosen provider and model from the book's preprocessing card. The default preprocessing model is preselected. Automatic runs use the default.
- Provider status reports which providers are available (names only), the effective defaults, and where each came from. Conversation and preprocessing views show the model actually in effect.
- **BREAKING (behavioral, minor):** AI is "enabled" when at least one provider has credentials, not only when `AI_PROVIDER` is set. With credentials but no default model, chat shows guidance to choose a model in Settings instead of reporting that AI is unconfigured.

Non-goals: entering or storing API keys in the UI; per-message model switching; UI control of effort, temperature, prompt caching, max steps, or prices (these stay in the environment and apply to every provider); per-user settings (the instance has a single shared login).

## Capabilities

### New Capabilities
- `ai-settings`: The persisted AI defaults (chat and preprocessing model), the Settings page that edits them, how they resolve against environment defaults, and the model listing behind the pickers.

### Modified Capabilities
- `ai-providers`: Credentials for several providers at once. Validation for the new per-provider variables. "AI enabled" now means at least one provider has credentials. Status covers available providers and defaults. Prompt caching follows the provider of each call. The preprocessing model may come from any provider with credentials.
- `literary-conversations`: A conversation can pin a provider and model. Each turn uses the conversation's model or the current default. A pinned model whose provider lost its credentials is reported, never silently replaced.
- `book-preprocessing`: A run can be started with a chosen provider and model. A queued or retried run keeps its model. Status shows the model of the current or last run.
- `self-hosting`: Documentation and example env/Compose files cover the per-provider credential variables and the in-app defaults.

## Impact

- **Config** (`src/server/config.ts`, `.env.example`, `docs/deployment.md`): new per-provider credential variables, cross-field validation, and `AI_PROVIDER` no longer being the only way to enable AI.
- **AI runtime** (`src/modules/ai`): goes from one fixed model to a resolver that builds (and caches) a model for any `(provider, model)` with credentials. Provider options are computed per provider. A new model-listing client per provider.
- **Database**: a new `ai_settings` table (a single row of defaults) and nullable `ai_provider`/`ai_model` columns on `conversations`. The preprocessing job payload and run row carry the chosen provider and model. One Drizzle migration.
- **Server functions/routes**: settings get/update, list models, set conversation model, and the start-preprocess input. A new `/settings` route and a header link.
- **UI**: the Settings page, a model picker component, a conversation model control, and a model choice on the preprocessing card.
- **Usage/pricing**: unchanged. Usage rows already record provider and model, and models without a price show cost as unknown.
- **Dependencies**: none new. Model listing uses `fetch` against each provider's REST endpoint.
