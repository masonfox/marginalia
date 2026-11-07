## Purpose

Lets readers own a global discussion prompt while retaining access to Marginalia's evolving default and its required technical integration.

## ADDED Requirements

### Requirement: Global editable discussion prompt
Settings SHALL show the effective editable discussion prompt and whether Default or Custom is active. In Default mode the editor SHALL show the latest default discussion text. Saving SHALL persist a global custom replacement, including edits to grounding, evidence/interpretation structure, stance, style, and spoiler instructions. Unsaved edits SHALL NOT affect conversations. This setting SHALL use the same instance access protection as other settings and SHALL be editable without configured AI credentials.

#### Scenario: Save and reload
- **WHEN** a reader edits the default discussion prompt and saves
- **THEN** Custom is active and reloading Settings shows the saved text

#### Scenario: Discard draft
- **WHEN** a reader edits without saving and leaves Settings
- **THEN** the effective prompt remains unchanged

### Requirement: Ownership and default updates
The editor SHALL explain that custom discussion prompts do not receive Marginalia's default discussion improvements. A saved custom prompt SHALL remain unchanged across default updates and application restarts. Readers in Default mode SHALL automatically use the latest default.

#### Scenario: Upgrade with a custom prompt
- **WHEN** Marginalia updates its default discussion prompt while Custom is active
- **THEN** the saved custom discussion text remains effective without automatic merging

#### Scenario: Upgrade in default mode
- **WHEN** Marginalia updates its default discussion prompt while Default is active
- **THEN** subsequent replies use the latest default

### Requirement: Return to default
Settings SHALL offer Return to default in Custom mode. Activating it SHALL clear the custom override, show the latest default discussion text, and resume automatic default improvements.

#### Scenario: Restore after an upgrade
- **WHEN** a reader returns to default after Marginalia has updated its default
- **THEN** the next reply uses that latest default rather than the version originally customized

### Requirement: Global application at reply boundaries
Saved changes and resets SHALL apply to replies started afterwards in all new and existing conversations without restarting. A generation already in progress SHALL retain the prompt it started with throughout its tool loop. Historical messages SHALL remain unchanged.

#### Scenario: Existing conversation
- **WHEN** a reader saves a custom prompt then sends a message in an existing conversation
- **THEN** the new reply uses the custom prompt and earlier messages remain unchanged

#### Scenario: Save during generation
- **WHEN** a reader saves or resets while a reply is generating
- **THEN** that reply retains its original prompt and the next reply uses the new setting

### Requirement: Maintained technical contract
Marginalia SHALL maintain citation marker format, tool contracts and budgets, and runtime book/scope context separately from the editable discussion text. Custom text SHALL NOT alter server citation verification, book access, or retrieval bounds. Settings SHALL explain this boundary and that changing spoiler instructions can change what the assistant discusses from its own knowledge. Scope notices SHALL continue to state retrieval bounds accurately and SHALL NOT claim the default spoiler instructions are active when Custom is active.

#### Scenario: Custom spoiler instructions
- **WHEN** a custom prompt permits discussing later events in a bounded conversation
- **THEN** the custom instructions are sent, retrieval remains bounded, and the notice distinguishes tool access from custom spoiler behavior

#### Scenario: Technical instructions retained
- **WHEN** a custom prompt replaces the default discussion text
- **THEN** the request still includes maintained citation syntax, tool constraints, and current book/scope context, and citations are verified as before
