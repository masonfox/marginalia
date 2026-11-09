## Context

See proposal.md for motivation and scope. `src/modules/conversation/prompt.ts` currently composes discussion policy, citation syntax, tool budget, and dynamic book/scope information in one string. `chat.ts` records `PROMPT_VERSION` per assistant message. Existing tests and specs require stable request prefixes. Settings already has database-backed singleton configuration and protected server functions.

## Goals / Non-Goals

**Goals:** Preserve a clear ownership boundary, resolve settings once per reply, and identify the effective prompt behind each new assistant message.

**Non-Goals:** Per-conversation overrides, prompt templates with executable interpolation, automatic merging, prompt history UI, changes to preprocessing or title prompts, and broader retrieval access.

## Decisions

### Separate technical context from editable policy

Extract a maintained technical block and a default discussion block. The technical block contains book handles/titles/authors, scope labels as factual context, supported tool contracts and budgets, and citation marker syntax. The discussion block contains grounding, treatment of retrieved data, evidence/interpretation structure, stance, style, and spoiler policy. Make it clear that editable discussion instructions are intentional reader instructions rather than book reference data. The technical contract takes precedence in the assembled prompt.

For default mode, compose current discussion text with generated spoiler instructions matching the books' scopes. For editing, expose a standalone default discussion text explaining how to respect the runtime scope labels, without embedding any conversation's books or scope values. Saving that text creates the custom policy used alongside runtime context. This avoids exposing template variables or freezing one conversation's metadata into the global prompt. Test parity of default bounded, whole-book, and mixed-scope behavior after extraction.

Editing the entire assembled string was rejected because it exposes dynamic context and can break citations and tools. Additive preferences were rejected because the reader wants ownership of the discussion prompt, including grounding and spoiler behavior.

### Persist one nullable override

Add a nullable conversation discussion prompt to singleton settings storage. Null means managed default; non-null means custom, even if the saved text happens to match today's default. Keep custom text verbatim rather than merging it with later defaults. Reject whitespace-only input and cap saved text at 32,000 characters with matching client/server validation; reset is an explicit operation, not an empty-text convention. These validation choices are implementation defaults.

Reuse Settings access protection and persistence patterns. Read the stored value for each new reply rather than caching indefinitely in process memory. A failed save leaves the previously effective value intact.

### Snapshot per generation and identify content

Resolve the setting once when a reply starts and reuse the assembled prompt across every model step. Store an effective prompt identifier with the assistant message using the existing prompt-version field: include the maintained prompt version, Default/Custom mode, and a deterministic digest of the effective discussion text. No timestamps or random identifiers enter model context. Old message metadata remains valid and unchanged. Prompt edits intentionally invalidate the cached prefix for subsequent turns; historical message replay remains unchanged.

### Make ownership visible

Add a Conversation prompt section in Settings with Default/Custom status, an editable text area, Save, and Return to default. Explain the loss of automatic discussion improvements before saving custom text. Explain that technical instructions still update and scope controls still bound tool access. Returning to default clears the override and refreshes the editor from the current default. Update conversation notices to avoid promising default spoiler behavior under Custom.

## Risks / Trade-offs

- Custom prompts can weaken grounding or reveal spoilers from model knowledge -> explain reader ownership; keep actual retrieval scope and citation verification enforced server-side.
- Models may fail to follow even maintained instructions -> retain parsing/verification and tool validation rather than relying on prompt precedence alone.
- Global edits affect ongoing discussions and prefix caching -> apply only at reply boundaries and retain historical messages.
- A custom prompt can miss valuable discussion improvements -> make reset available and restore the latest default, not a historical copy.

## Migration Plan

Add a nullable settings column with no custom value for existing installations. Deploy prompt composition and Settings changes together; existing installations remain in Default mode. No message backfill is required. Roll back application code without dropping the nullable column; the older app ignores custom settings, and retaining the value allows restoration on redeploy.
