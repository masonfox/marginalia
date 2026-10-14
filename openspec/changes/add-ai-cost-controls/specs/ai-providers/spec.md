## ADDED Requirements

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
