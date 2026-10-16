## ADDED Requirements

### Requirement: Multiple providers and in-app model choice documented
The deployment documentation SHALL explain how to configure credentials for several providers at once with the per-provider variables, how the existing `AI_PROVIDER`, `AI_API_KEY`, and `AI_BASE_URL` map onto them, and that API keys are only ever set in the environment. It SHALL explain that defaults chosen in the app's Settings page take precedence over `AI_MODEL` and `AI_PREPROCESS_MODEL`, how to reset to the environment defaults, and that conversations and preprocessing runs can use their own models. The example environment file and the reference Compose file SHALL pass the new variables through, empty by default.

#### Scenario: Operator adds a second provider
- **WHEN** an operator with Anthropic configured through `AI_PROVIDER` wants OpenAI models available too
- **THEN** the documentation tells them which variable to add and that the Settings page will then offer OpenAI models

#### Scenario: Compose passes variables through
- **WHEN** an operator sets `AI_OPENAI_API_KEY` in `.env` and starts the reference Compose stack
- **THEN** the application receives the variable
