## Why

Conversation titles currently copy the opening prompt, making long questions difficult to recognize in lists. A single concise title can improve navigation without changing the conversation or revealing an answer.

## What Changes

- Generate a recognizable title once from the opening user prompt, using the model selected for that first turn (conversation override or chat default).
- Keep the immediate provisional title and stream the reply independently; naming errors leave the provisional title intact.
- Persist once-only eligibility, bounded background execution, and terminal outcomes across retries and restarts. Manual renames always take precedence.
- Refresh the header and conversation lists when naming completes, including after reply completion.
- Record title-generation usage separately and include it in conversation totals.
- Do not evolve titles, backfill existing conversations, or add a title-model setting.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `literary-conversations`: Once-only opening-prompt titles, provisional fallback, manual precedence, lifecycle behavior, and completion refresh.
- `ai-usage`: Distinct title-call accounting included in conversation totals without attributing it to an assistant reply.

## Impact

Conversation chat preparation, repository, schema and migrations; AI naming prompt and worker; existing pg-boss job kinds, handlers, configuration and recovery dispatch; conversation loaders and list refresh; usage schema/types and aggregation. No new external service or title-model preference. Existing conversations retain their titles. Only proposal artifacts are produced by this change workflow.
