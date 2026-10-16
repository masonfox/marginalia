## MODIFIED Requirements

### Requirement: Provider selection by configuration
The system SHALL support several providers configured at once (OpenAI, Anthropic, Google, and an OpenAI-compatible endpoint), each with the credentials stored for it in Settings (see the ai-settings capability). The system SHALL NOT read provider credentials or model choices from environment variables. Every model call SHALL use a provider and model resolved for that call (from a conversation's own model, a preprocessing run's chosen model, or the defaults) with that provider's current credentials, using the Vercel AI SDK. No code change or restart SHALL be needed to add, change, or switch between providers.

#### Scenario: Hosted provider
- **WHEN** an Anthropic key is saved in Settings and an Anthropic model is the chat default
- **THEN** conversations use that model with that key

#### Scenario: Local OpenAI-compatible endpoint
- **WHEN** an OpenAI-compatible base URL is saved with no API key and an OpenAI-compatible model is selected
- **THEN** calls for that selection use that endpoint

#### Scenario: Old environment variables ignored
- **WHEN** the application starts with `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY` set and nothing saved in Settings
- **THEN** no provider is available and conversation features report that AI is not configured

### Requirement: Provider configuration validation
The system SHALL validate the remaining AI environment settings (`AI_MAX_STEPS`, `AI_TEMPERATURE`, `AI_EFFORT`, `AI_PROMPT_CACHE`, `AI_PRICES`, `AI_PREPROCESS_AUTO`) at startup and SHALL refuse to start, naming each offending variable, when one is invalid. Provider credentials SHALL be validated when they are saved in Settings. Secret values SHALL never appear in errors, logs, or API responses.

#### Scenario: Invalid setting
- **WHEN** `AI_MAX_STEPS` is not a positive whole number
- **THEN** the application exits with a non-zero status and an error naming the variable

#### Scenario: Missing model
- **WHEN** a reader saves a chat default with a provider but no model id
- **THEN** the save is rejected with an error naming the missing model, and nothing is stored

#### Scenario: Key not leaked
- **WHEN** saving credentials fails or a model call fails with an error that echoes the key
- **THEN** no API key value appears in the error, the logs, or the response

### Requirement: AI is optional
The system SHALL start and operate normally, including library, search, and reading features, when no provider has credentials. Conversation features SHALL then report that AI is not configured, point to Settings, and SHALL NOT attempt model calls. When at least one provider is available but the model a call would use cannot be resolved (no chat default, or a selection whose provider is not available), the system SHALL NOT attempt the call and SHALL say which model is missing or unavailable and that it can be chosen in Settings.

#### Scenario: No provider configured
- **WHEN** the application runs with no provider credentials saved
- **THEN** the UI shows guidance to add a provider in Settings in place of the chat input and the chat endpoint returns a service-unavailable response

#### Scenario: Credentials without a default model
- **WHEN** an Anthropic key is saved and no chat default is saved
- **THEN** a conversation without its own model shows guidance to choose a model in Settings in place of the chat input, and the chat endpoint returns a service-unavailable response

### Requirement: Provider status
The system SHALL expose whether AI is enabled (at least one provider available), the names of the available providers, and, for the chat default and the preprocessing default, the provider and model and whether its provider is available. Status SHALL NOT expose API keys. Base URLs and key hints SHALL appear only in the Settings page's provider section.

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
Preprocessing SHALL use the preprocessing default from Settings, which is either its own model selection or the chat default. The preprocessing default and the model chosen for a run MAY use any available provider, with that provider's credentials. Preprocessing requests SHALL honor the configured prompt caching and effort settings where they apply to their provider, and the provider status SHALL show the preprocessing default.

#### Scenario: Small model for bulk work
- **WHEN** the chat default is a mid-tier model and the saved preprocessing default is a small model
- **THEN** conversations use the first and preprocessing uses the second

#### Scenario: Default
- **WHEN** no preprocessing model is saved
- **THEN** preprocessing uses the chat default

#### Scenario: Different provider for preprocessing
- **WHEN** the chat default is an Anthropic model and the saved preprocessing default is a Google model, with both providers available
- **THEN** preprocessing calls go to Google with the Google key

#### Scenario: Set without provider
- **WHEN** `AI_PREPROCESS_MODEL` is set in the environment
- **THEN** the application starts, the variable is ignored, and preprocessing uses the default from Settings
