## Parallelization Overview

Sections A to D can run in separate worktrees. Each owns a disjoint set of files; shared files are assigned to exactly one section, and other sections consume only the interfaces named under "Contract". Merge order: A, then B and C and D in any order, then E.

Contract (agreed up front so sections can start together; A defines it, others code against it):
- `modules/analysis/index.ts` exports: `getBookMap(db, editionId, bound): Promise<UnitSummaryView[]>`, `lookupObservations(db, editionId, name, bound, limit): Promise<ObservationView[]>`, `hasCurrentPreprocessing(db, editionId): Promise<boolean>`, `getPreprocessStatus(db, editionId)`, `markDerivedStale(tx, editionId)`, `PREPROCESS_PROMPT_VERSION`.
- Job kind `analysis.preprocess` with payload `{ editionId: string }`.
- Config: `config.ai.preprocessModel` (string, defaults to model) and `config.preprocessAuto` (boolean).

## 1. Section A: Schema, migration, queries (owner: `src/modules/analysis/schema.ts`, `queries.ts`, `index.ts`, `src/modules/usage/schema.ts`, `src/modules/usage/record.ts`, `drizzle/*`)

Depends on: nothing. Blocks: B, C, D (types and queries), E.

- [ ] 1.1 Add `unit_summaries`, `unit_observations`, and `preprocess_runs` tables in `modules/analysis/schema.ts`, with cascade on edition delete and the indexes needed for bounded reads
- [ ] 1.2 Add `preprocess` to `ai_usage.purpose` and a nullable `edition_id` column (cascade); update `recordUsage` and add a per-edition usage total query in `modules/usage`
- [ ] 1.3 Generate the additive migration with drizzle and register the schema in the db schema barrel
- [ ] 1.4 Implement bounded queries: `getBookMap`, `lookupObservations` (name_key match, reading order, caps), filtering by `end_position <= bound`, not stale, and current prompt version
- [ ] 1.5 Implement write helpers: `saveUnitResult` (transactional replace for one unit), `markDerivedStale`, run progress updates, and `getPreprocessStatus`
- [ ] 1.6 Integration tests: bound filtering (including bound inside a unit), stale hiding, cascade on edition delete, profile cannot leak

## 2. Section B: Prompts and job handler (owner: `src/modules/analysis/prompts.ts`, `process.ts`, `handler.ts`, `*.test.ts`, `src/server/jobs/kinds.ts`, `runtime.ts`, `handlers.ts`, `src/modules/catalog/ingest.ts`, `persist.ts`)

Depends on: A (schema and write helpers), and the config contract from D1 (can stub). Blocks: E.

- [ ] 2.1 Write the unit prompt and output schema (summary, observations with kind, note, citations) and `PREPROCESS_PROMPT_VERSION`
- [ ] 2.2 Implement the unit processor: gather unit passages with locators, chunk long units, call the model with the previous unit's summary only, merge chunk results
- [ ] 2.3 Verify citations with the existing quote verification, restricting to passages of the unit; store unverified items flagged
- [ ] 2.4 Record usage per call through `recordUsage` with purpose `preprocess` and the edition id, including failed attempts that report usage
- [ ] 2.5 Add the `analysis.preprocess` kind (key by edition, retry limit) and the handler: skip current units, process the rest sequentially, update progress, throw after the loop if any unit failed, `NonRetryableError` when AI is unconfigured
- [ ] 2.6 Enqueue the job at the end of successful ingest and reparse when `preprocessAuto` is on and AI is configured; call `markDerivedStale` inside the reparse transaction
- [ ] 2.7 Tests with a mock model: per-unit resume, dedup, stale regeneration, unverified citations, no later text in the model input, no enqueue without AI

## 3. Section C: Conversation integration (owner: `src/modules/conversation/prompt.ts`, `tools.ts`, `chat.ts`, `prompt.test.ts`, `tools.int.test.ts`, `prefix.test.ts`)

Depends on: A's query signatures (code against the contract; integrate-test after A merges). Independent of B and D.

- [ ] 3.1 Extend `buildSystemPrompt` with per-book maps, the guide-not-evidence instruction, the size cap and deterministic shortening, and bump `PROMPT_VERSION` to 5
- [ ] 3.2 Load maps in `chat.ts` at the start of each turn using each book's bound; omit for books without current preprocessing
- [ ] 3.3 Add the `lookupObservations` tool appended last in the fixed tool order: book check, bound, caps, unavailable and not-found messages
- [ ] 3.4 Tests: map limited by scope, identical prompt across turns, tool order stable, other-book rejection, no-preprocessing behavior

## 4. Section D: UI, config, and docs (owner: `src/server/config.ts`, `config.test.ts`, `src/modules/ai/*`, `src/routes/**` book detail, `src/fns/*`, `src/components/*` for the new card, `compose.yaml`, `docs/deployment.md`, `README.md`)

Depends on: A for status and usage queries (UI wiring), B for the job kind (start action). Config and docs parts (4.1 to 4.3, 4.7) can start immediately.

- [x] 4.1 Add `AI_PREPROCESS_MODEL` and `AI_PREPROCESS_AUTO` (default false) with validation; `AiConfig.preprocessModel` defaults to `model`; startup error naming the variable when set without a provider
- [x] 4.2 Add `getPreprocessModel()` in `modules/ai` using the existing provider, key, caching and effort handling; show the model in provider status
- [x] 4.3 Config tests for defaults, invalid values, and missing provider
- [ ] 4.4 Server functions `getPreprocessStatus` and `startPreprocess` in `src/fns` (reject when AI is unconfigured or the edition is not ready)
- [ ] 4.5 Preprocessing card on the book detail page: status, progress, model, spend with estimate label, start and regenerate action, privacy warning, polling while active
- [ ] 4.6 Component or route tests for states: not started, running, complete, stale, failed, AI unconfigured
- [x] 4.7 Document the variables, whole-book privacy, cost figures, and recommendations in `docs/deployment.md`; pass the variables through `compose.yaml` without enabling auto; update the env list in `README.md` and satisfy `server/docs.test.ts`

## 5. Section E: Integration and verification (after A, B, C, D merge)

- [ ] 5.1 End-to-end check against a mock provider: ingest, preprocess, start a bounded conversation, confirm the map and tool respect the bound
- [ ] 5.2 Run `pnpm` typecheck, lint, unit and integration tests; fix cross-section drift
- [ ] 5.3 Run `openspec validate add-book-preprocessing`
