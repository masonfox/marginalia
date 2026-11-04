## ADDED Requirements

### Requirement: Required secret key
The application SHALL require `MARGINALIA_SECRET_KEY` at startup and SHALL refuse to start, naming the variable, when it is missing or does not decode from base64 to at least 32 bytes. Its value SHALL never appear in logs, errors, or API responses. The reference Compose file SHALL pass it through from the environment or an `.env` file and SHALL NOT contain a default or placeholder value.

#### Scenario: Missing secret key
- **WHEN** the application starts without `MARGINALIA_SECRET_KEY`
- **THEN** it exits with a non-zero status and an error naming the variable and how to generate one

#### Scenario: Too short
- **WHEN** `MARGINALIA_SECRET_KEY` decodes to fewer than 32 bytes
- **THEN** the application exits with an error naming the variable and the expected format, without printing the value

### Requirement: AI providers configured in Settings documented
The deployment documentation SHALL explain that AI providers, API keys, and default models are configured in the app's Settings page, not in environment variables, and that the former `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, and `AI_PREPROCESS_MODEL` variables are not read. It SHALL explain how to generate `MARGINALIA_SECRET_KEY`, that it must be backed up with the database, that database backups contain the API keys encrypted with it, and that changing or losing it means entering the keys again. It SHALL state that on an instance without `AUTH_PASSWORD` anyone who can reach it can add, replace, or remove provider keys. It SHALL explain that conversations and preprocessing runs can use their own models. The example environment file SHALL contain `MARGINALIA_SECRET_KEY`, empty, with a generation hint, and no AI credential variables.

#### Scenario: Operator adds a second provider
- **WHEN** an operator with Anthropic configured wants OpenAI models available too
- **THEN** the documentation tells them to add the OpenAI key in Settings, with no restart

#### Scenario: Operator plans backups
- **WHEN** an operator reads the backup guidance
- **THEN** they learn that the database holds encrypted API keys and that `MARGINALIA_SECRET_KEY` must be kept to read them

## MODIFIED Requirements

### Requirement: AI provider configuration documented
The deployment documentation SHALL describe every remaining AI environment variable (`AI_MAX_STEPS`, `AI_TEMPERATURE`, `AI_EFFORT`, `AI_PROMPT_CACHE`, `AI_PRICES`, `AI_PREPROCESS_AUTO`) with its default and purpose, give an example of adding a hosted provider and a local OpenAI-compatible endpoint in Settings, and state that conversation text and retrieved passages are sent to the selected provider. It SHALL recommend a model setup (a current mid-tier model for conversations, a higher-quality alternative, and a small model for bulk work) with the reasoning behind it, explain prompt caching and reasoning effort and how they affect cost, state which settings current models ignore (such as temperature on current Anthropic models), explain how to override model prices, and state that the cost shown in the app is an estimate that may differ from the provider's bill.

#### Scenario: Operator enables AI
- **WHEN** an operator reads the documentation
- **THEN** they can add a provider in Settings and understand what data leaves the instance

#### Scenario: Operator chooses a model
- **WHEN** an operator reads the AI section to pick a model
- **THEN** they find a recommended setup, the effort setting to start with, and how to see what conversations cost in the app

#### Scenario: Operator upgrading with a temperature set
- **WHEN** an operator with a temperature configured switches to a current Anthropic model
- **THEN** the documentation tells them the setting is ignored on that model and can be removed

### Requirement: Preprocessing configuration documented
The deployment documentation SHALL describe the preprocessing default in Settings and the setting that enables automatic preprocessing on ingest (`AI_PREPROCESS_AUTO`), with its default and purpose. It SHALL state that preprocessing sends the full text of each book to the selected provider, not only retrieved passages, give approximate token and cost figures for a novel with a small model and with the conversation model, recommend leaving automatic preprocessing off for large libraries or using a small model, and note that a local OpenAI-compatible endpoint keeps text on the instance. An invalid `AI_PREPROCESS_AUTO` SHALL fail startup validation naming the variable. The reference Compose file SHALL pass it through without a default that enables automatic preprocessing.

#### Scenario: Operator weighs cost and privacy
- **WHEN** an operator reads the AI section
- **THEN** they find the preprocessing settings, an estimate of cost, and a statement that whole books are sent to the provider

#### Scenario: Invalid setting
- **WHEN** the automatic preprocessing setting is not a valid boolean
- **THEN** the application exits with an error naming the variable

#### Scenario: Compose default
- **WHEN** an operator uses the reference Compose file without setting `AI_PREPROCESS_AUTO`
- **THEN** automatic preprocessing is off
