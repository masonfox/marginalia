## MODIFIED Requirements

### Requirement: Provider selection by configuration
The system SHALL support several providers configured at once (OpenAI, Anthropic, Google, and an OpenAI-compatible endpoint), each with credentials from environment variables: `AI_OPENAI_API_KEY`, `AI_ANTHROPIC_API_KEY`, `AI_GOOGLE_API_KEY`, and `AI_OPENAI_COMPATIBLE_BASE_URL`, each with an optional matching `_BASE_URL` (or, for the OpenAI-compatible endpoint, an optional `AI_OPENAI_COMPATIBLE_API_KEY`). `AI_PROVIDER` with `AI_API_KEY` and `AI_BASE_URL` SHALL keep working and SHALL supply the credentials of the provider named by `AI_PROVIDER`. A provider SHALL be available when its required credentials are present: an API key for hosted providers, a base URL for the OpenAI-compatible endpoint. Every model call SHALL use a provider and model resolved for that call (from a conversation's own model, a preprocessing run's chosen model, or the defaults) with that provider's credentials, using the Vercel AI SDK. No code change or restart SHALL be needed to switch between available providers.

#### Scenario: Hosted provider
- **WHEN** `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY` are set for a supported hosted provider and nothing is saved in Settings
- **THEN** conversations use that model

#### Scenario: Local OpenAI-compatible endpoint
- **WHEN** `AI_OPENAI_COMPATIBLE_BASE_URL` is set with no API key and an OpenAI-compatible model is selected
- **THEN** calls for that selection use that endpoint

#### Scenario: Two providers at once
- **WHEN** both `AI_ANTHROPIC_API_KEY` and `AI_OPENAI_API_KEY` are set, the chat default is an Anthropic model, and a conversation has an OpenAI model of its own
- **THEN** that conversation uses the OpenAI model with the OpenAI key, and other conversations use the Anthropic model with the Anthropic key

### Requirement: Provider configuration validation
The system SHALL validate AI configuration at startup and SHALL refuse to start, naming each offending variable, when: `AI_PROVIDER` is set without `AI_MODEL`; `AI_PROVIDER` names a hosted provider and no API key for it is set; `AI_PROVIDER` is `openai-compatible` and no base URL for it is set; `AI_PREPROCESS_MODEL` is set without `AI_PROVIDER`; a provider's credentials are given both through the `AI_PROVIDER` variables and its own variables; a provider-specific base URL is set without that provider's key (hosted providers); or any base URL is not a valid http(s) URL. `AI_MODEL`, `AI_API_KEY`, or `AI_BASE_URL` set without `AI_PROVIDER` SHALL be ignored with a startup warning naming the variable, as before. Secret values SHALL never appear in errors, logs, or API responses.

#### Scenario: Missing model
- **WHEN** `AI_PROVIDER` is set without `AI_MODEL`
- **THEN** the application exits with a non-zero status and an error naming the model variable

#### Scenario: Duplicate credentials
- **WHEN** `AI_PROVIDER` is `anthropic` with `AI_API_KEY` set and `AI_ANTHROPIC_API_KEY` is also set
- **THEN** the application exits at startup with an error naming both variables

#### Scenario: Key not leaked
- **WHEN** configuration validation fails
- **THEN** no API key value appears in the error output

### Requirement: AI is optional
The system SHALL start and operate normally, including library, search, and reading features, when no provider has credentials. Conversation features SHALL then report that AI is not configured and SHALL NOT attempt model calls. When at least one provider has credentials but the model a call would use cannot be resolved (no chat default, or a selection whose provider is no longer available), the system SHALL NOT attempt the call and SHALL say which model is missing or unavailable and that it can be chosen in Settings.

#### Scenario: No provider configured
- **WHEN** the application runs with no provider credentials
- **THEN** the UI shows setup guidance in place of the chat input and the chat endpoint returns a service-unavailable response

#### Scenario: Credentials without a default model
- **WHEN** `AI_ANTHROPIC_API_KEY` is set, `AI_PROVIDER` is unset, and no chat default is saved
- **THEN** a conversation without its own model shows guidance to choose a model in Settings in place of the chat input, and the chat endpoint returns a service-unavailable response

### Requirement: Provider status
The system SHALL expose whether AI is enabled (at least one provider available), the names of the available providers, and, for the chat default and the preprocessing default, the provider and model, whether it comes from Settings or the environment, and whether its provider is available. It SHALL NOT expose API keys or base URLs.

#### Scenario: Status shown
- **WHEN** a signed-in reader opens a conversation
- **THEN** the provider and model in effect for it are visible and no API key is

#### Scenario: Available providers listed
- **WHEN** Anthropic and an OpenAI-compatible endpoint have credentials
- **THEN** status lists exactly those two providers, by name only

### Requirement: Prompt caching where supported
The system SHALL request prompt caching on every call to a provider that needs it to be requested (Anthropic), whichever default or override selected that provider, so that on each step of the tool loop and on later turns the unchanged prefix of the request (tool definitions, system prompt, and earlier messages) is billed at the provider's cached rate. Calls to providers that cache automatically (OpenAI, Google) or do not cache (OpenAI-compatible endpoints) SHALL carry no cache instruction. Caching SHALL be on by default, and an operator SHALL be able to turn it off. Whether caching took effect SHALL be observable through the recorded cache-read and cache-write tokens.

#### Scenario: Tool loop on Anthropic
- **WHEN** a reply on an Anthropic model takes several steps
- **THEN** every step after the first reports cache-read tokens covering at least the tool definitions and system prompt

#### Scenario: Follow-up within the cache lifetime
- **WHEN** the reader sends a second message within a few minutes of the first reply finishing, with the same model
- **THEN** the first step of the new reply reports cache-read tokens for the earlier part of the conversation

#### Scenario: Anthropic chosen as an override
- **WHEN** the chat default is an OpenAI model and a conversation uses an Anthropic model of its own
- **THEN** that conversation's requests carry the Anthropic cache instruction and the OpenAI requests carry none

#### Scenario: Caching disabled
- **WHEN** the operator turns caching off
- **THEN** requests carry no cache instruction and conversations still work

### Requirement: Optional preprocessing model
The system SHALL accept an optional `AI_PREPROCESS_MODEL` naming a model of the `AI_PROVIDER` provider, which is the environment default for preprocessing. When it is unset and nothing is saved in Settings, preprocessing SHALL use the chat default. The preprocessing default saved in Settings and the model chosen for a run MAY use any available provider, with that provider's credentials. A value set without `AI_PROVIDER` SHALL fail startup validation naming the variable, and secrets SHALL never appear in errors. Preprocessing requests SHALL honor the configured prompt caching and effort settings where they apply to their provider, and the provider status SHALL show the preprocessing default.

#### Scenario: Small model for bulk work
- **WHEN** `AI_MODEL` is a mid-tier model, `AI_PREPROCESS_MODEL` is a small model, and nothing is saved in Settings
- **THEN** conversations use the first and preprocessing uses the second

#### Scenario: Default
- **WHEN** `AI_PREPROCESS_MODEL` is unset and no preprocessing default is saved
- **THEN** preprocessing uses the chat default

#### Scenario: Different provider for preprocessing
- **WHEN** the chat default is an Anthropic model and the saved preprocessing default is a Google model, with both providers available
- **THEN** preprocessing calls go to Google with the Google key

#### Scenario: Set without provider
- **WHEN** `AI_PREPROCESS_MODEL` is set and `AI_PROVIDER` is not
- **THEN** the application exits at startup with an error naming the variable
