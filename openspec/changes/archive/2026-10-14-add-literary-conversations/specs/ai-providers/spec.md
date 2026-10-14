## ADDED Requirements

### Requirement: Provider selection by configuration
The system SHALL select its language model from environment variables naming a provider (OpenAI, Anthropic, Google, or an OpenAI-compatible endpoint), a model, and, where applicable, an API key and base URL, using the Vercel AI SDK. No code change SHALL be needed to switch providers.

#### Scenario: Hosted provider
- **WHEN** the provider, model, and API key are set for a supported hosted provider
- **THEN** conversations use that model

#### Scenario: Local OpenAI-compatible endpoint
- **WHEN** the provider is `openai-compatible` with a base URL and model and no API key
- **THEN** conversations use that endpoint

### Requirement: Provider configuration validation
The system SHALL validate AI configuration at startup and SHALL refuse to start when a provider is set but its required settings (model, API key, or base URL) are missing or invalid, naming each offending variable. Secret values SHALL never appear in errors, logs, or API responses.

#### Scenario: Missing model
- **WHEN** a provider is set without a model
- **THEN** the application exits with a non-zero status and an error naming the model variable

#### Scenario: Key not leaked
- **WHEN** configuration validation fails
- **THEN** the API key value does not appear in the error output

### Requirement: AI is optional
The system SHALL start and operate normally, including library, search, and reading features, when no provider is configured. Conversation features SHALL report that AI is not configured and SHALL NOT attempt model calls.

#### Scenario: No provider configured
- **WHEN** the application runs without a provider
- **THEN** the UI shows setup guidance in place of the chat input and the chat endpoint returns a service-unavailable response

### Requirement: Provider status
The system SHALL expose whether AI is enabled and which provider and model are configured, without exposing secrets.

#### Scenario: Status shown
- **WHEN** a signed-in reader opens a conversation
- **THEN** the provider and model names are visible and the API key is not
