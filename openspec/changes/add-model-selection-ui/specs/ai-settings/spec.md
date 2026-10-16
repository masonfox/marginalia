## Purpose

Lets readers choose, in the app, the default provider and model for conversations and for book preprocessing. Choices are saved in the database and fall back to the environment defaults, so the model can change without editing configuration or restarting.

## ADDED Requirements

### Requirement: Model selection
A model selection SHALL be a provider and a model id. The provider SHALL be one that has credentials configured. The model id SHALL be a non-empty string of at most 200 characters, trimmed of surrounding whitespace, with no control characters. The system SHALL NOT require the model id to appear in the provider's model list.

#### Scenario: Provider without credentials rejected
- **WHEN** a reader saves a selection naming a provider that has no credentials configured
- **THEN** the save is rejected with a message that the provider is not configured, and nothing is stored

#### Scenario: Unlisted model accepted
- **WHEN** a reader types a model id the provider's list does not include
- **THEN** the selection is saved and a notice says the model was not found in the provider's list

#### Scenario: Blank model rejected
- **WHEN** a reader saves a selection whose model id is empty or only whitespace
- **THEN** the save is rejected and nothing is stored

### Requirement: Persisted defaults
The system SHALL persist two defaults: the chat default, a model selection, and the preprocessing default, which is either a model selection or "same as chat". The defaults SHALL apply to model calls started after they are saved, with no restart. Changing a default SHALL NOT change a call already in progress, a queued or running preprocessing job, or a conversation that has its own model.

#### Scenario: New default used without restart
- **WHEN** a reader saves a new chat default and then sends a message in a conversation without its own model
- **THEN** the reply is generated with the new default model

#### Scenario: Preprocessing follows chat
- **WHEN** the preprocessing default is "same as chat" and the chat default is changed
- **THEN** the next preprocessing run without an explicit choice uses the new chat default

#### Scenario: Running job unaffected
- **WHEN** the preprocessing default is changed while a preprocessing job is running
- **THEN** the running job finishes with the model it started with

### Requirement: Environment defaults
When no chat default has been saved, the chat default SHALL be the environment's `AI_PROVIDER` and `AI_MODEL`, and when those are unset there SHALL be no chat default. When no preprocessing default has been saved, the preprocessing default SHALL be `AI_PREPROCESS_MODEL` with the `AI_PROVIDER` provider when that variable is set, and otherwise "same as chat". A saved default SHALL take precedence over the environment. Each default SHALL be resettable on its own, which removes the saved value so the environment default applies again. When a saved default names a provider that no longer has credentials, the system SHALL keep the saved value, report it as unavailable, and SHALL NOT silently use another model.

#### Scenario: Existing deployment
- **WHEN** an instance configured only through `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY` is upgraded and nothing is saved in Settings
- **THEN** conversations and preprocessing use the same models as before the upgrade

#### Scenario: Saved default wins
- **WHEN** `AI_MODEL` is one model and a different chat default is saved in Settings
- **THEN** conversations without their own model use the saved default

#### Scenario: Reset to environment
- **WHEN** a reader resets the chat default
- **THEN** the saved chat default is removed and the environment's `AI_PROVIDER` and `AI_MODEL` apply again

#### Scenario: Saved provider loses credentials
- **WHEN** the saved chat default uses a provider whose credentials were removed from the environment
- **THEN** Settings shows that default as unavailable, and chat reports that the default model is unavailable instead of using a different model

### Requirement: Settings page
The system SHALL provide a Settings page, reachable from the app header, that shows the available providers (names only), the chat default, and the preprocessing default. For each default it SHALL show whether the value comes from Settings or from the environment, and SHALL offer a reset when it comes from Settings. The page SHALL be protected like every other page, and SHALL NOT show or accept API keys or base URLs. When no provider has credentials, the page SHALL explain that providers are configured through environment variables and SHALL NOT offer model pickers.

#### Scenario: Source shown
- **WHEN** a reader opens Settings on an instance whose chat model comes from `AI_MODEL` and nothing is saved
- **THEN** the chat default is shown with its provider and model, labelled as coming from the environment, with no reset action

#### Scenario: No providers
- **WHEN** a reader opens Settings and no provider has credentials
- **THEN** the page shows setup guidance naming the environment variables and offers no pickers

#### Scenario: Logged out
- **WHEN** a logged-out user opens the Settings page on a password-protected instance
- **THEN** they are redirected to the login page

### Requirement: Model listing
Model pickers SHALL offer, for the selected provider, the models returned by that provider's model-listing endpoint where one exists, and SHALL always accept a typed model id. For Google, only models that support text generation SHALL be listed. A listing SHALL be reused for a short period instead of being fetched on every open, and SHALL be refreshable on demand. When listing fails or the provider has no listing endpoint, the picker SHALL say so and SHALL still accept a typed model id. Listing errors SHALL NOT contain credentials. Models with a known price SHALL show it, and others SHALL show that the price is unknown.

#### Scenario: Hosted provider listing
- **WHEN** a reader opens the model picker with Anthropic selected and Anthropic credentials configured
- **THEN** the picker lists the models Anthropic returns for that key

#### Scenario: Listing unavailable
- **WHEN** the OpenAI-compatible endpoint does not answer its model-listing request
- **THEN** the picker says the list could not be loaded and still accepts a typed model id

#### Scenario: Key not leaked in listing error
- **WHEN** a model-listing request fails with an error that echoes the API key
- **THEN** the error shown in the picker does not contain the key
