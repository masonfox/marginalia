## ADDED Requirements

### Requirement: AI provider configuration documented
The deployment documentation SHALL describe every AI environment variable with its default and purpose, give an example for a hosted provider and for a local OpenAI-compatible endpoint, and state that conversation text and retrieved passages are sent to the configured provider.

#### Scenario: Operator enables AI
- **WHEN** an operator reads the documentation
- **THEN** they can configure a provider and understand what data leaves the instance
