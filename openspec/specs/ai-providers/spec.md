# ai-providers Specification

## Purpose

Selects and configures the language model that powers conversations through environment variables, so operators can switch providers without code changes.

## Requirements

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

### Requirement: Prompt caching where supported
The system SHALL request prompt caching from providers that need it to be requested (Anthropic), so that on each step of the tool loop and on later turns the unchanged prefix of the request (tool definitions, system prompt, and earlier messages) is billed at the provider's cached rate. Providers that cache automatically (OpenAI, Google) or do not cache (OpenAI-compatible endpoints) SHALL need no configuration. Caching SHALL be on by default, and an operator SHALL be able to turn it off. Whether caching took effect SHALL be observable through the recorded cache-read and cache-write tokens.

#### Scenario: Tool loop on Anthropic
- **WHEN** a reply on an Anthropic model takes several steps
- **THEN** every step after the first reports cache-read tokens covering at least the tool definitions and system prompt

#### Scenario: Follow-up within the cache lifetime
- **WHEN** the reader sends a second message within a few minutes of the first reply finishing
- **THEN** the first step of the new reply reports cache-read tokens for the earlier part of the conversation

#### Scenario: Caching disabled
- **WHEN** the operator turns caching off
- **THEN** requests carry no cache instruction and conversations still work

### Requirement: Reasoning effort configuration
The system SHALL accept an optional reasoning effort setting with the values `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, and SHALL pass it to the provider for every conversation request. When it is unset, the provider's default SHALL apply. An invalid value SHALL fail startup validation naming the variable. A value the selected model does not support SHALL NOT fail the request; the provider library maps or drops it and the system logs the warning.

#### Scenario: Effort set
- **WHEN** the operator sets effort to `low` on a model that supports effort
- **THEN** conversation requests are sent with low effort

#### Scenario: Invalid effort
- **WHEN** the effort variable is set to an unknown value
- **THEN** the application exits at startup with an error naming the variable

### Requirement: Unsupported sampling parameters
A configured temperature SHALL be sent only to models that accept it. When the selected model rejects sampling parameters (current Anthropic models), the temperature SHALL be left out of the request and a warning SHALL be logged, and the request SHALL proceed.

#### Scenario: Temperature on a current Claude model
- **WHEN** a temperature is configured and the model is Claude Sonnet 5.5
- **THEN** the request succeeds without a temperature and a warning is logged

#### Scenario: Temperature on a model that accepts it
- **WHEN** a temperature is configured and the model accepts sampling parameters
- **THEN** the request is sent with that temperature
