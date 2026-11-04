## Purpose

Lets readers configure AI providers and choose, in the app, the default provider and model for conversations and for book preprocessing. Provider credentials and defaults are saved in the database, so providers and models can change without editing configuration or restarting.

## ADDED Requirements

### Requirement: Provider credentials
The system SHALL let a reader configure, from the Settings page, credentials for each supported provider: OpenAI, Anthropic, and Google each take an API key and an optional base URL, and the OpenAI-compatible endpoint takes a base URL and an optional API key. There SHALL be at most one set of credentials per provider. A provider SHALL be available when its stored credentials include what it requires (an API key for hosted providers, a base URL for the OpenAI-compatible endpoint) and its key can be decrypted. Saved, replaced, or removed credentials SHALL apply to model calls and model listings started afterwards, in every application process, with no restart. Removing a provider's credentials SHALL NOT change saved defaults or conversation models that name it; they SHALL be reported as unavailable.

#### Scenario: Add a provider
- **WHEN** a reader enters an Anthropic API key in Settings and saves it
- **THEN** Anthropic becomes available in every model picker without a restart

#### Scenario: Two providers at once
- **WHEN** Anthropic and OpenAI both have saved keys, the chat default is an Anthropic model, and a conversation has an OpenAI model of its own
- **THEN** that conversation uses the OpenAI model with the OpenAI key, and other conversations use the Anthropic model with the Anthropic key

#### Scenario: Local endpoint without a key
- **WHEN** a reader saves an OpenAI-compatible base URL with no API key
- **THEN** the OpenAI-compatible provider is available and calls for it use that URL

#### Scenario: Remove a provider in use
- **WHEN** the chat default uses OpenAI and a reader removes the OpenAI credentials
- **THEN** the chat default is kept, Settings shows it as unavailable, and chat refuses turns that would use it instead of using another model

#### Scenario: Worker sees the change
- **WHEN** the application runs as separate web and worker processes and a reader saves a new key in the web UI
- **THEN** the next preprocessing job run by the worker uses the new key

### Requirement: Credentials are write-only and checked on save
The system SHALL NOT return a stored API key to the browser in any response. After saving, the system SHALL show only that a key is set and its last four characters, and the key field SHALL never be pre-filled. Before storing credentials, the system SHALL check them against the provider's model-listing endpoint; it SHALL refuse credentials the provider rejects as unauthorized, and when the check fails for another reason (unreachable, no listing endpoint, timeout) it SHALL refuse unless the reader chooses to save anyway. Changing the base URL of a provider that has a stored API key SHALL require the API key to be entered again in the same save. A base URL SHALL be an absolute http(s) URL with no user name, password, query, or fragment. Errors from the check SHALL NOT contain credentials.

#### Scenario: Key not returned
- **WHEN** a reader saves an OpenAI key and reloads Settings
- **THEN** the page shows that a key is set and its last four characters, and no response contains the key

#### Scenario: Rejected key
- **WHEN** a reader saves an Anthropic key the provider rejects as unauthorized
- **THEN** nothing is stored and the page shows the provider's error without the key

#### Scenario: Unreachable local endpoint
- **WHEN** a reader saves an OpenAI-compatible base URL that does not answer
- **THEN** nothing is stored and the page offers to save anyway

#### Scenario: Base URL change needs the key
- **WHEN** OpenAI has a stored key and a reader changes only its base URL
- **THEN** the save is refused until the key is entered again

#### Scenario: Credentials in base URL rejected
- **WHEN** a reader saves a base URL of the form `https://user:pass@host/v1`
- **THEN** the save is rejected and nothing is stored

### Requirement: Credentials encrypted at rest
The system SHALL store API keys encrypted with a key derived from `MARGINALIA_SECRET_KEY`, using authenticated encryption bound to the provider, and SHALL never store or log them in plaintext. When a stored key cannot be decrypted with the current secret key, the system SHALL treat that provider as unavailable, SHALL report in Settings that its key must be entered again, and SHALL keep starting and serving other features.

#### Scenario: Database dump
- **WHEN** an operator inspects a dump of the database after keys were saved
- **THEN** no API key appears in it in plaintext

#### Scenario: Secret key changed
- **WHEN** the application restarts with a different `MARGINALIA_SECRET_KEY` than the one that encrypted the stored keys
- **THEN** the application starts, those providers are unavailable, and Settings asks for their keys again

### Requirement: Model selection
A model selection SHALL be a provider and a model id. The provider SHALL be one that is available. The model id SHALL be a non-empty string of at most 200 characters, trimmed of surrounding whitespace, with no control characters. The system SHALL NOT require the model id to appear in the provider's model list.

#### Scenario: Provider without credentials rejected
- **WHEN** a reader saves a selection naming a provider that has no credentials
- **THEN** the save is rejected with a message that the provider is not configured, and nothing is stored

#### Scenario: Unlisted model accepted
- **WHEN** a reader types a model id the provider's list does not include
- **THEN** the selection is saved and a notice says the model was not found in the provider's list

#### Scenario: Blank model rejected
- **WHEN** a reader saves a selection whose model id is empty or only whitespace
- **THEN** the save is rejected and nothing is stored

### Requirement: Persisted defaults
The system SHALL persist two defaults: the chat default, a model selection, and the preprocessing default, which is either a model selection or "same as chat". Until one is saved, there SHALL be no chat default and the preprocessing default SHALL be "same as chat". Each default SHALL be clearable on its own: clearing the chat default leaves no chat default, and clearing the preprocessing default makes it "same as chat". The defaults SHALL apply to model calls started after they are saved, with no restart. Changing a default SHALL NOT change a call already in progress, a queued or running preprocessing job, or a conversation that has its own model. When a default names a provider that is not available, the system SHALL keep it, report it as unavailable, and SHALL NOT silently use another model.

#### Scenario: Fresh instance
- **WHEN** a reader adds a provider on a new instance and has not chosen a default
- **THEN** a conversation without its own model shows guidance to choose a model in Settings

#### Scenario: New default used without restart
- **WHEN** a reader saves a new chat default and then sends a message in a conversation without its own model
- **THEN** the reply is generated with the new default model

#### Scenario: Preprocessing follows chat
- **WHEN** the preprocessing default is "same as chat" and the chat default is changed
- **THEN** the next preprocessing run without an explicit choice uses the new chat default

#### Scenario: Clear preprocessing default
- **WHEN** a reader clears a saved preprocessing model
- **THEN** the preprocessing default is "same as chat" again

#### Scenario: Running job unaffected
- **WHEN** the preprocessing default is changed while a preprocessing job is running
- **THEN** the running job finishes with the model it started with

### Requirement: Settings page
The system SHALL provide a Settings page, reachable from the app header, with a providers section, the chat default, and the preprocessing default. The providers section SHALL list each supported provider with whether it is configured, its key hint, its base URL, and actions to add, replace the key, change the base URL, and remove. Each default SHALL offer a clear action when one is saved and SHALL show when its provider is unavailable. When no provider is available, the page SHALL offer the providers section and SHALL NOT offer model pickers. The page SHALL be protected like every other page.

#### Scenario: No providers
- **WHEN** a reader opens Settings and no provider has credentials
- **THEN** the page invites them to add a provider and offers no model pickers

#### Scenario: Logged out
- **WHEN** a logged-out user opens the Settings page on a password-protected instance
- **THEN** they are redirected to the login page

### Requirement: Model listing
Model pickers SHALL offer, for the selected provider, the models returned by that provider's model-listing endpoint where one exists, and SHALL always accept a typed model id. For Google, only models that support text generation SHALL be listed. A listing SHALL be reused for a short period instead of being fetched on every open, SHALL be refreshable on demand, and SHALL NOT be reused after the provider's credentials change. When listing fails or the provider has no listing endpoint, the picker SHALL say so and SHALL still accept a typed model id. Listing errors SHALL NOT contain credentials. Models with a known price SHALL show it, and others SHALL show that the price is unknown.

#### Scenario: Hosted provider listing
- **WHEN** a reader opens the model picker with Anthropic selected and an Anthropic key saved
- **THEN** the picker lists the models Anthropic returns for that key

#### Scenario: Key replaced
- **WHEN** a reader replaces a provider's key and opens the picker within the listing reuse period
- **THEN** the list is fetched again with the new key

#### Scenario: Listing unavailable
- **WHEN** the OpenAI-compatible endpoint does not answer its model-listing request
- **THEN** the picker says the list could not be loaded and still accepts a typed model id

#### Scenario: Key not leaked in listing error
- **WHEN** a model-listing request fails with an error that echoes the API key
- **THEN** the error shown in the picker does not contain the key
