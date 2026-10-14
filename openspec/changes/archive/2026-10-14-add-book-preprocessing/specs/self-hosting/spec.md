## ADDED Requirements

### Requirement: Preprocessing configuration documented
The deployment documentation SHALL describe `AI_PREPROCESS_MODEL` and the setting that enables automatic preprocessing on ingest (`AI_PREPROCESS_AUTO`), with defaults and purposes. It SHALL state that preprocessing sends the full text of each book to the configured provider, not only retrieved passages, give approximate token and cost figures for a novel with a small model and with the conversation model, recommend leaving automatic preprocessing off for large libraries or using a small model, and note that a local OpenAI-compatible endpoint keeps text on the instance. Invalid values of the new variables SHALL fail startup validation naming the variable. The reference Compose file SHALL pass the new variables through without defaults that enable automatic preprocessing.

#### Scenario: Operator weighs cost and privacy
- **WHEN** an operator reads the AI section
- **THEN** they find the preprocessing variables, an estimate of cost, and a statement that whole books are sent to the provider

#### Scenario: Invalid setting
- **WHEN** the automatic preprocessing setting is not a valid boolean
- **THEN** the application exits with an error naming the variable

#### Scenario: Compose default
- **WHEN** an operator uses the reference Compose file without setting the new variables
- **THEN** automatic preprocessing is off
