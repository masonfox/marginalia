## Why

Readers cannot currently customize how Marginalia discusses their books. Issue #46 calls for direct prompt editing while preserving an evolving default and a clear way to return to it.

## What Changes

- Add a global conversation prompt editor in Settings, initialized from the current default discussion instructions.
- Saving creates a custom override used by new and existing conversations on their next reply. Unsaved edits have no effect.
- Allow editing grounding, evidence/interpretation structure, stance, style, and spoiler instructions. Keep citation format, tool contracts, and runtime book/scope context maintained by Marginalia.
- Explain that custom discussion prompts do not receive default discussion prompt improvements; never merge or overwrite saved custom text automatically.
- Provide Return to default, which clears the override and resumes the latest default and future improvements.
- Preserve retrieval scope enforcement, citation verification, and historical messages regardless of prompt customization.

## Capabilities

### New Capabilities

- `conversation-prompt-settings`: Global prompt editing, persistence, mode visibility, and reset behavior.

### Modified Capabilities

- `literary-conversations`: Make discussion instructions customizable, preserve technical contracts, and account for prompt revisions in request stability and message metadata.

## Impact

- Settings UI/server functions and database-backed settings storage with a migration.
- Conversation prompt composition and chat generation, prompt identity metadata, and associated tests.
- Scope notices must describe customization accurately without implying that retrieval bounds have changed.
- No provider changes or new external dependencies are expected. Implementation is outside this proposal.
