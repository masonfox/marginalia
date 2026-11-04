## ADDED Requirements

### Requirement: Conversation model
A conversation SHALL either have its own model selection or follow the chat default. A reader SHALL be able to choose a model when starting a conversation, and to change or clear the conversation's model later from the conversation view, using the same picker as Settings. Each turn SHALL use the conversation's own model when it has one, and otherwise the chat default at the time the turn starts. Changing the model SHALL apply from the next turn: it SHALL NOT affect a reply that is streaming, and it SHALL NOT be possible while a reply is streaming. A retried reply SHALL use the model in effect when the retry starts. Changing the model SHALL NOT alter the system prompt, tool definitions, or stored history sent to the model. Each assistant reply SHALL record the provider and model that produced it.

#### Scenario: Override for one conversation
- **WHEN** the chat default is a mid-tier model and a reader sets a higher-quality model on one conversation
- **THEN** replies in that conversation use the higher-quality model, and other conversations keep using the default

#### Scenario: Following the default
- **WHEN** a conversation has no model of its own and the chat default changes
- **THEN** the conversation's next reply uses the new default

#### Scenario: Clearing the override
- **WHEN** a reader clears a conversation's model
- **THEN** its next reply uses the chat default

#### Scenario: Switch mid-conversation
- **WHEN** a reader changes the model after several turns and sends a message
- **THEN** the reply uses the new model, the earlier messages are sent unchanged, and the earlier replies still show the model that produced them

#### Scenario: Locked while streaming
- **WHEN** a reply is streaming
- **THEN** the conversation's model control is disabled until the reply ends

### Requirement: Unavailable conversation model
When the model a conversation would use names a provider that no longer has credentials, the system SHALL NOT send the turn and SHALL NOT silently use another model. The conversation view SHALL say that the model is unavailable, name it, and offer to choose another model or clear the override, and the chat endpoint SHALL refuse the turn with a response that says so.

#### Scenario: Provider removed
- **WHEN** a conversation's own model uses OpenAI and the OpenAI credentials are removed in Settings
- **THEN** opening the conversation shows that its model is unavailable with a way to change it, and sending a message is refused without calling any model

### Requirement: Model in effect shown
The conversation view SHALL show the provider and model the next reply will use and whether it is the conversation's own model or the default. Each assistant reply SHALL show, in its usage details, the model that produced it.

#### Scenario: Default shown
- **WHEN** a reader opens a conversation without its own model
- **THEN** the view shows the default provider and model, labelled as the default

#### Scenario: Reply provenance
- **WHEN** a conversation has replies from two models
- **THEN** each reply's usage details name the model that produced it
