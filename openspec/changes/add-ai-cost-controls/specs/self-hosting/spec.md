## MODIFIED Requirements

### Requirement: AI provider configuration documented
The deployment documentation SHALL describe every AI environment variable with its default and purpose, give an example for a hosted provider and for a local OpenAI-compatible endpoint, and state that conversation text and retrieved passages are sent to the configured provider. It SHALL recommend a model setup (a current mid-tier model for conversations, a higher-quality alternative, and a small model for bulk work) with the reasoning behind it, explain prompt caching and reasoning effort and how they affect cost, state which settings current models ignore (such as temperature on current Anthropic models), explain how to override model prices, and state that the cost shown in the app is an estimate that may differ from the provider's bill.

#### Scenario: Operator enables AI
- **WHEN** an operator reads the documentation
- **THEN** they can configure a provider and understand what data leaves the instance

#### Scenario: Operator chooses a model
- **WHEN** an operator reads the AI section to pick a model
- **THEN** they find a recommended setup, the effort setting to start with, and how to see what conversations cost in the app

#### Scenario: Operator upgrading with a temperature set
- **WHEN** an operator with a temperature configured switches to a current Anthropic model
- **THEN** the documentation tells them the setting is ignored on that model and can be removed
