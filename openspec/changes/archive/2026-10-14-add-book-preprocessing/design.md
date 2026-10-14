## Context

Reading units (`modules/catalog/reading-units.ts`) and conversation bounds already exist, as do usage recording (`modules/usage`, `ai_usage` with `purpose` limited to `conversation`), prompt caching, and a stable-prefix rule (`PROMPT_VERSION` in `modules/conversation/prompt.ts`). Jobs are declared in `server/jobs/kinds.ts` and wired in `runtime.ts`. Ingest and reparse live in `modules/catalog/ingest.ts` and `persist.ts`; a reparse already re-anchors conversation bounds inside its transaction. AI config is in `server/config.ts` (`AI_MODEL`, etc.) and `modules/ai`.

## Goals / Non-Goals

**Goals:** per-unit summaries and observations, bounded by the same position as retrieval; cheap, resumable generation; use in the prompt and one tool.
**Non-Goals:** whole-book themes or profiles; embeddings or semantic search; a different provider for preprocessing; editing derived data by hand.

## Decisions

1. **New module `modules/analysis`**, owning tables, prompts, the unit processor, the job handler, and bounded queries. It depends on `catalog` (units, passages), `retrieval` (quote verification), `ai`, and `usage`. `conversation` imports only its query functions (`getBookMap`, `lookupObservations`).

2. **Tables** (one additive migration, all cascading on edition delete):
   - `unit_summaries`: edition_id, unit_ordinal, unit_label, end_position, summary, citations jsonb (locator, quote, verified), model, prompt_version, parser_version, stale boolean, created_at. Unique (edition_id, unit_ordinal) for current rows.
   - `unit_observations`: edition_id, unit_ordinal, end_position, name, name_key (normalized for lookup), kind (character|place|object|motif), note, citations jsonb, model, prompt_version, parser_version, stale.
   - `preprocess_runs`: edition_id, status, total_units, done_units, failed_units, model, last_error, started/finished. One row per edition, reused.
   Bounded reads filter `end_position <= bound AND NOT stale AND prompt_version = current`.

3. **Unit rows keyed by end position, not ordinal alone.** Reading units are derived at read time, not stored. The processor derives units, then writes rows with the unit's ordinal, label, and end position. Unit-skipping compares the stored (ordinal, end position, prompt version, not stale) with the derived unit.

4. **Job `analysis.preprocess`**: payload `{ editionId }`, key editionId, retryLimit 2, concurrency 1 by default (new `preprocessConcurrency` is not added; fixed at 1 to bound spend). The handler loops over units sequentially; each unit's summary and observations are written in one transaction, then the run's progress is updated. A unit failure is recorded and the loop continues; after the loop, if any unit failed the handler throws so the job retries only unfinished units (finished ones are skipped). A `NonRetryableError` is used for missing AI config.

5. **One model call per unit** returning structured JSON (summary plus observations, each with quotes and locators). Input: the unit's passages with locators, plus the previous unit's summary (and no later text) for continuity. The model is told to describe only this unit. Long units are split into chunks of passages under a token cap and merged: summary per chunk is concatenated and reduced; observations are merged by name_key.

6. **Grounding**: quotes are checked against the unit's passages using the existing verify function (`modules/retrieval/verify.ts`). Locators outside the unit are marked unverified. Unverified items are kept and flagged, and the prompt and tool say so.

7. **Staleness**: `catalog.reparse` marks rows stale in its transaction via a dependency hook alongside the conversation re-anchoring. Prompt version change is staleness by comparison, with no write. Regeneration replaces the stale rows for a unit in the unit's transaction.

8. **Model selection**: add `AI_PREPROCESS_MODEL` and `AI_PREPROCESS_AUTO` (default false) to config; `AiConfig` gets `preprocessModel` defaulting to `model`. `modules/ai` exposes `getPreprocessModel()` built with the same provider settings. Caching applies; effort is passed as for conversations.

9. **Usage**: widen `ai_usage.purpose` to include `preprocess`, add nullable `edition_id` (FK, cascade), and make conversation_id already nullable usage. `recordUsage` accepts the new purpose. A per-edition total query is added.

10. **Conversation integration**: `buildSystemPrompt` takes optional per-book maps (summaries up to bound). The map is rendered after the book list, in a section titled as a guide, with a size cap (character budget per book; when over, the oldest summaries are shortened to their first sentence, then dropped, deterministically). The map is loaded when the stream starts and so is stable between turns unless scope or summaries change. `PROMPT_VERSION` goes to 5. A new tool `lookupObservations` is appended last in the fixed tool order. Both are omitted when no current preprocessing exists.

11. **UI**: a preprocessing card on the book detail page with status, progress, model, spend, an action button (start or regenerate), and a privacy warning. It polls while a job is active, as the library list does. Server functions: `getPreprocessStatus`, `startPreprocess` (rejected when AI is not configured or the edition is not ready).

## Risks / Trade-offs

- **Cost drift**: automatic mode on a large library can be expensive. Mitigated by default off and docs.
- **Summary quality and leakage within a unit**: a unit summary may mention a later fact in the same unit while the bound sits at a unit end only. Since bounds are always unit ends, this is safe; a bound inside a unit hides the whole unit.
- **Cache churn**: the map changes the prefix once per scope change or regeneration, which costs one cache write. Accepted.
- **Reparse changing unit boundaries**: all rows go stale; the whole book is regenerated. Accepted for simplicity.
- **Prompt size**: a 40-unit map at about 100 tokens each is about 4k tokens, cached.

## Migration Plan

Additive migration; no backfill. Existing editions show "not started". Rollback is dropping the new tables and column.

## Open Questions

- Whether concurrency for `analysis.preprocess` should be configurable; assumed fixed at 1 for now.
- Observation kinds beyond the four listed; assumed to be a closed set.
