## Context

`src/modules/analysis` owns the machine layer: `unit_summaries`, `unit_observations` and `preprocess_runs`. It provides bounded reads (`getBookMap`, `lookupObservations`) that filter `end_position <= bound`, not stale, and current `PREPROCESS_PROMPT_VERSION`. Rows are deleted and reinserted per unit on regeneration, so row ids are not stable. Reading units are derived at read time (`catalog/reading-units.ts`) and are not stored.

A reparse runs `replaceEditionStructure` (`catalog/persist.ts`) in one transaction. When the parser version changes, it matches old to new locators, writes `locator_aliases` (every historical locator stays one hop from a current one), builds a `rebase(oldBound)` function that never moves a bound later, and calls the `onReplaced` hook. Today the hook (`server/jobs/handlers.ts`) does two things: `rebaseScopes` and `markDerivedStale`.

The conversation sends the bounded map as an untrusted user message after the system prompt (`buildBookMapMessage`). It is part of the cached prefix. `PROMPT_VERSION` is `"6"`. Tools are sent in fixed order, ending with `lookupObservations`. The research trail is built client-side from stored message parts (`lib/research-trail.ts`).

There is one shared password per instance and no reader identity.

## Goals / Non-Goals

**Goals:**
- One reader-layer module and one merged-view read path used by the Guide, glosses, and the assistant, so bounding rules are written exactly once.
- A single anchoring primitive for every reader-authored position, with explicit spoiler-safe behavior on reparse.
- No changes to machine tables or the preprocessing job.
- Phases that can ship and be reviewed independently, in epic dependency order.

**Non-Goals:**
- Per-reader identity. The position table is shaped so a `reader_id` can be added later, but no column is added now.
- Real-time collaboration or edit history on notes and corrections.
- Model-assisted alias clustering, and feeding subjects back into the preprocessing prompt.
- Full-text indexing of notes. Note counts per book are small.

## Decisions

### 1. New module `src/modules/guide` for the reader layer and merged view

The new module owns the reader tables and exposes the merged, bounded reads: `getGuideMap`, `listSubjects`, `getSubjectTimeline`, `resolveObservations`, `listNotes`, and `glossesFor`. It depends on `analysis` (machine rows), `catalog` (reading units, passages), and `retrieval` (quote verification and locator resolution). `conversation` switches from `analysis.getBookMap` and `analysis.lookupObservations` to the guide equivalents. `analysis` stays machine-only and unchanged. *Alternative:* add the overlay inside `analysis`. Rejected because it mixes regenerable and durable data, and it would make the "never edit machine rows" principle depend on discipline rather than module boundaries.

### 2. Anchors: one primitive, two reparse directions

Every reader-authored position is an **anchor**: `{ locator, position }`. `position` is the anchored passage's reveal position, cached for SQL comparisons. The locator is the identity, and the position is a cache that is recomputed on reparse. Positions fall into two kinds, and each moves in the direction that hides rather than spoils:

| Kind | Examples | Visible when | On reparse |
|---|---|---|---|
| **Bound** (a ceiling) | reading position, conversation scope | content ≤ bound | existing `rebase`: never moves later |
| **Reveal** (a floor) | alias reveal, note "as of", correction unit anchor | anchor ≤ bound | forward the locator via the match map; if it was removed, use the **next surviving** passage: never moves earlier |

`replaceEditionStructure` gains a pure `buildForward(old, matches, newPassages)`, the sibling of `buildRebase`. It passes `forward(locator) → { locator, position } | null` to `onReplaced` along with `rebase`. The hook in `handlers.ts` then also calls `rebaseReadingPositions(tx, editionId, rebase)` and `guide.reanchor(tx, editionId, forward)`. `reanchor` runs after the new TOC is inserted, so it can derive the new reading units inside the transaction. It uses them to detect detached corrections and cleared unit attachments. *Alternative:* resolve locators lazily at read time through `locator_aliases`. Rejected because every bounded SQL filter would need a join through aliases, and "next surviving passage" can't be expressed that way.

"End of book" note anchors store `position = NULL` and are visible only to whole-book bounds (`bound IS NULL`).

### 3. Tables (additive migrations, all `ON DELETE CASCADE` from `editions`)

- `reading_positions`: `edition_id` PK, `max_position` int null, `scope_label` text null, `updated_at`. A row exists only when the position is set. `max_position`/`scope_label` both null means finished. This has the same shape and check constraint as `conversation_editions`, so the scope components and `rebase` apply unchanged. A future reader identity changes the PK to `(edition_id, reader_id)`.
- `guide_subjects`: `id`, `edition_id`, `display_key` (a member name_key, nullable), `kind` (nullable override).
- `guide_subject_aliases`: PK `(edition_id, name_key)`, `subject_id` FK cascade, `is_primary`, `reveal_locator`, `reveal_position` (null if and only if primary). Partial unique index: one primary per subject. A name_key absent from this table is an **implicit subject**, so nothing is materialized for the common case.
- `guide_dismissed_proposals`: PK `(edition_id, key_a, key_b)`, with `key_a < key_b`.
- `guide_gloss_exclusions`: PK `(edition_id, name_key)`.
- `guide_corrections`: `id`, `edition_id`, `target` (`summary`|`observation`), `unit_locator`, `name_key` (null if and only if summary), `action` (`replace`|`suppress`), `text`, `citation` jsonb (DerivedCitation), `fingerprint` (sha256 of the machine text acknowledged), `detached` bool, timestamps. Unique on `(edition_id, target, unit_locator, coalesce(name_key, ''))`.
- `reader_notes`: `id`, `edition_id`, `title`, `body`, `as_of_kind` (`unit`|`passage`|`end`), `as_of_locator`, `as_of_position`, `as_of_label`, `subject_key` (name_key, nullable), `unit_locator` (nullable), `source_conversation_id` (FK `SET NULL`), timestamps. Check: at most one attachment.
- `messages.guide_context` jsonb, nullable: `[{ editionId, scopeLabel, mapFingerprint }]`, written for assistant messages generated with a map.

Subjects use the stable keys from the issues: `name_key` and unit anchor locators, never machine row ids.

### 4. The unit anchor is the locator of the unit's first passage

Machine rows carry `unit_ordinal` and `end_position`, but no locator. The merged view derives reading units once per request (`getReadingUnits`), maps ordinal to start locator, and checks that the stored `end_position` matches the derived unit, which it always does for current rows. The start locator is chosen because a TOC target is exactly what survives a reparse that doesn't restructure chapters. *Alternative:* add `unit_locator` to machine rows. Rejected because it needs a machine-schema change and a backfill or `PREPROCESS_PARSER_VERSION` bump for no behavioral gain.

### 5. Merging happens in TypeScript, over bounded SQL reads

The machine rows are read with the existing bounded filters. The edition's corrections and aliases are loaded whole, since there are few per book, and then merged. A correction applies when its `unit_locator` and `name_key` match a current row. It is flagged `regeneratedSince` when `sha256(current machine text) ≠ fingerprint`. For observations, the machine text is the unit's notes for that key, sorted and joined. Suppressed rows are dropped, and replaced rows take the reader's text and citation. The same function feeds the Guide, glosses, the map, and the tool, which satisfies "one rule" in the specs.

### 6. Name resolution and proposals

`resolveSubjects(editionId, bound)` builds `Map<name_key, SubjectRef>` from the aliases visible at the bound: primaries always, and aliases where `reveal_position <= bound`. Any other key maps to its own implicit ref `k:<name_key>`. The display name follows the guide-subjects rule. "First appearance" is `min(end_position)` per key over current observations, from one grouped query.

Proposals are computed on demand over the distinct `(name_key, kind)` visible at the bound. A pair is proposed when the two names share a kind and one name's significant tokens are a subset of the other's. Significant tokens have at least 3 characters and are not in a small stop and honorific list (the, of, mr, mrs, lady, lord, sir, saint, captain, …). Already-linked and dismissed pairs are excluded, and at most 50 proposals are shown. Proposals are not persisted, only dismissals.

The merge dialog always shows the reveal default and a spoiler warning, because "later first appearance" can be earlier than the true reveal.

### 7. Guide routes and the visit bound

There is a layout route `/books/$editionId_/guide` with children `chapters` (the default), `index`, `index/$subjectRef`, `notes`, `notes/new`, and `notes/$noteId`. The layout holds the visit bound (the position default, the picker choice, or a peek) in React state and context, not in the URL or storage. This satisfies the requirement that it end on reload or exit. The bound is sent with each server-function call and validated server-side against current reading units, the same way the scope dialog does it. Server functions live in `src/fns/guide.ts`. The `ScopeChoices`/`groupUnits` pieces of `components/scope.tsx` are reused for the position control, the visit picker, and the note anchor picker.

### 8. Glosses are computed server-side per displayed range

`glossesFor(editionId, passages[])` takes the displayed passages (locator, text, reveal position). It resolves subjects at the maximum bound among them, then filters per passage at that passage's own bound. It matches surface forms: the raw observed `name` values plus subject names, case-sensitive, whole-word with Unicode letter boundaries, at least 3 characters, and minus exclusions. It matches against a single compiled alternation, longest-first, and returns `{ locator, start, end, subjectRef }` for the first mention of each subject. `passage-text.tsx` renders the ranges the same way it renders citation highlights. The card is fetched on open (`getGlossCard(subjectRef, passageLocator)`). The on/off preference lives in `localStorage`, like "Show tool details".

### 9. Assistant integration in one prompt bump

- **Map:** `buildBookMapMessage` takes merged summaries. Corrected units render with a `source="reader correction"` attribute inside the existing escaped block. The map stays in the cached prefix. Its inputs grow by exactly "in-scope summary corrections", so the prefix changes only when the reader edits something visible to that conversation.
- **`lookupObservations`:** same name, same position in the tool order. It now uses `resolveObservations`, and its result gains `subject`, `observedAs`, and `source`. Previously stored results replay unchanged, because the schema change affects only new calls.
- **`lookupNotes`:** appended last. Input is `{ book, query?, subject? }`. With no query, it lists up to 20 titles. With a query, it matches by `ILIKE` on the title and body, or resolves the subject. It returns at most 5 notes, clips bodies to 2,000 characters, and wraps the result with an attribution string.
- **Prompt:** adds the corrections and notes trust paragraph, and `PROMPT_VERSION` goes from 6 to 7. The tool list change and the description change are both covered by this bump, per the stable-prefix requirement.
- **`guide_context`:** `chat.ts` already renders the map once per turn. It hashes each book's block and stores `{ editionId, scopeLabel, mapFingerprint }` on the assistant message.

### 10. Trail: synthesized guide step, actions reuse Guide flows

`lib/research-trail.ts` prepends a guide step from `message.guideContext` when present, and excludes it from the search and read counts. On expand, a server function returns the current merged summaries for that scope, plus the current fingerprint, so the UI can show "guide has changed since". The correction dialog is a shared component used by the Guide and the trail. "Save as note" in `reply-selection.tsx` navigates to `guide/notes/new` with the excerpt, conversation link, and anchor passed as router state. Nothing is persisted until the reader saves.

### 11. Reading position control and conversation hooks

The position control is a card on the book page that reuses `ScopeChoices`. The move-back confirm uses `alert-dialog`. `NewConversationDialog` receives the position and highlights the match without selecting it. The widen control in `conversation-controls.tsx` shows a non-blocking "Also update my reading position?" prompt after a successful widen past the position. Accepting calls the same server function as the book page.

## Risks / Trade-offs

- **[Strict bounds hide the current unit everywhere]** Glosses in Chapter 1 show nothing, and a Guide bound mid-chapter drops that chapter. → This is the existing spec rule, applied consistently. It is documented in the UI copy ("as of the end of the previous chapter"). We accept it rather than weaken the bound.
- **[Shared position collides in multi-reader households]** → A visible caveat on every position control. A position only ever hides too much, never spoils, as long as nobody advances it past another reader. The PK is ready for `reader_id`.
- **[False-positive glosses on common words ("Will", "Hope")]** → Case-sensitive surface forms, a 3-character minimum, first mention only, and per-edition exclusions.
- **[Merge default reveal can be too early]** → The reveal is always shown and editable in the dialog, with a warning. Proposals never apply unconfirmed.
- **[Merged view cost]** Deriving reading units adds a query to each Guide or gloss call. → The units are memoized per request. The reader tables are small. Gloss computation happens once per displayed range, not per passage.
- **[Prompt cache misses after edits]** → Only corrections within a conversation's scope change its map. Notes and aliases go through tools and never touch the prefix.
- **[Detached corrections after restructuring reparses]** → Detached corrections are listed for review and never silently reapplied to a different unit.
- **[Large change]** → Tasks are phased in epic order (#22/#21 → #23 → #24/#25 → #26 → #27). Each phase ships behind no flag but is independently reviewable. Assistant behavior changes only in the last phase.

## Migration Plan

1. Additive Drizzle migrations per phase: reading positions, then subjects, then corrections, then notes, then `messages.guide_context`. No backfill. Existing conversations show no guide step.
2. `PROMPT_VERSION` 6 → 7 ships with phase 7. Older messages keep their recorded version.
3. Rollback: revert the code. The new tables are inert without it, and can be dropped by a down migration. Machine tables and canonical text are untouched throughout.
4. Docs: add the shared-position caveat and the Guide to the README and self-hosting notes.

## Open Questions

- The exact stop and honorific word list for proposals, and the cap of 50. These are tunable constants.
- How many observations a gloss card shows before linking to the full timeline (default: 3 most recent).
- Whether `lookupNotes` should move to Postgres full-text search if note volume grows. The tool contract doesn't change either way.
