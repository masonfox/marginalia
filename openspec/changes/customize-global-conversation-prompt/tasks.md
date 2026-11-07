## 1. Persist global prompt ownership

- [ ] 1.1 Add a nullable global discussion prompt setting and migration; verify existing installations resolve to Default and custom values survive reload/restart.
- [ ] 1.2 Add protected read/save/reset server operations with whitespace-only rejection and a 32,000-character limit; verify invalid or unauthorized writes leave the effective setting unchanged and reset stores no override.

## 2. Compose and apply prompts

- [ ] 2.1 Extract maintained technical context and editable discussion policy; verify default bounded, whole-book, and mixed-scope behavior, citation syntax, and tool contracts remain covered by prompt tests.
- [ ] 2.2 Resolve global settings once per reply and compose Default or Custom policy with current book/scope context; verify new and existing conversations use saved changes on their next reply and active generations retain their original prompt on every step.
- [ ] 2.3 Record effective prompt identity with assistant messages; verify custom edits change the identifier, unchanged inputs retain stable prefixes, and historical messages/metadata replay unchanged.
- [ ] 2.4 Verify custom grounding and spoiler text replaces default policy while tool access, scope enforcement, and server citation verification remain intact through chat integration tests.

## 3. Expose editing and reset

- [ ] 3.1 Add the Settings editor with Default/Custom status, Save, update-tradeoff explanation, and technical/scope boundary explanation; verify save/reload, unsaved draft dismissal, validation errors, and operation without provider credentials.
- [ ] 3.2 Add Return to default and refresh the editor with the latest default; verify a custom prompt survives a simulated default update and reset uses the new default on the next reply.
- [ ] 3.3 Update conversation scope notices for Custom mode; verify bounded, whole-book, and mixed-scope notices accurately distinguish retrieval access from custom spoiler behavior.

## 4. Validate integration

- [ ] 4.1 Run relevant Settings, prompt, chat, scope, citation, and prefix tests plus repository type/lint checks; verify no regressions and document any failures before considering the change complete.
- [ ] 4.2 Exercise save-custom, resume-conversation, update-default, and return-to-default flows in the UI; verify the complete behavior matches both delta specs.
