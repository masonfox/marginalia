## Context

See proposal.md for motivation. The relevant current state:

- `conversation_editions.max_position` exists and is honored by `searchBooks` and `readPassage` (compared against `reveal_position`), but nothing sets it. `getOutline` ignores it, so once bounds exist it would leak chapter titles past the bound.
- `toc_entries` stores the nested TOC (`parent_id`, `ordinal`, `depth`, `label`, `passage_id`). Passages carry `position` (NULL outside the linear order) and `reveal_position`.
- `replaceEditionStructure` (catalog) replaces an edition's structure in one transaction and, on a parser-version change, matches old passages to new ones (`matchLocators`) to write locator aliases. Positions are not stable across reparses.
- The catalog must not import the conversation module, because the conversation module already imports the catalog.
- `add-ai-cost-controls` needs the system prompt to be byte-stable between steps and turns. `add-book-preprocessing` will generate one summary per reading unit.

## Goals / Non-Goals

**Goals:**
- Derive reading units deterministically from data already stored, with no AI and no per-book configuration.
- Keep a chosen scope correct across reparses without reader action.
- Keep the system prompt a pure function of the conversation's books and scopes.

**Non-Goals:**
- Hiding later chapter titles in the reader's own UI. The picker and book detail TOC show the full TOC, and the reader already sees it there.
- Manual editing or overriding of reading units.
- Per-turn or per-message scopes, and a visible "scope widened" marker in the transcript.
- Remembering or prefilling a reader's progress across conversations.

## Decisions

### D1. Reading units are computed on demand, not stored
`getReadingUnits(db, editionId)` in `modules/catalog/reading-units.ts` loads the edition's TOC entries joined to their passages' `position`, plus linear section and position bounds, and passes them to a pure `deriveReadingUnits(...)` function. Each unit is `{ ordinal, label, path, startPosition, endPosition, startLocator }`.

- *Why:* The input is a few hundred rows. Computing on demand needs no migration, no backfill for already-ingested editions, and cannot go stale after a reparse. The pure function is unit-testable against hand-built TOCs, including the *Rise of Endymion* and *Infinite Jest* shapes.
- *Alternative:* a `reading_units` table written inside `replaceEditionStructure`. It gives preprocessing a foreign key, but it needs a backfill job for existing editions and another table to keep consistent. Preprocessing can identify a unit by `(edition, parser version, startLocator)`. It already plans to mark derived rows stale on reparse, so it gains little from a table. If it later needs one, it can materialize units then.

### D2. Derivation rules
Implemented as specified in the `reading-scope` spec. These notes record why the rules are what they are:
- **Leaves as units, any entry as a boundary.** Using only leaves avoids a "Part Two" unit that would overlap its chapters. Ending a unit at the next entry of any depth keeps a part title page, which may itself be a spoiler (for example "Part Three: The Death of …"), out of the preceding chapter's range.
- **Order by target position, not TOC order.** Some TOCs are out of reading order. Sorting by start position and dropping non-increasing starts keeps ranges valid and contiguous.
- **Front and back matter.** A case-insensitive label pattern list (cover, title page, title, copyright, contents, table of contents, dedication, epigraph, "also by", "praise for", acknowledg(e)ments, about the author, about the publisher, notes, endnotes, index, bibliography, glossary). It applies only to the leading and trailing runs of units, so a chapter that happens to be called "Notes" in the middle of a novel is kept. Excluded leading matter is folded into the first unit's start, and trailing matter into the last unit's end.
- **Labels.** `path` is the ancestor labels plus the entry label. The display label joins them with " › ". Exact duplicates after that get " (2)", " (3)", and so on in reading order.
- **Fallback.** With fewer than three TOC units, use linear spine sections that have linear passages, with the same matter filter applied to section titles.

### D3. Scope storage: add `scope_label`, keep `max_position`
Additive migration: `conversation_editions.scope_label text NULL`. `max_position IS NULL` means whole book, and then `scope_label` is NULL too. A check constraint ensures both are NULL or both are set.

- *Why store the label:* after a reparse the TOC can change, and so can units and their labels. A snapshot keeps "through Chapter 22" readable regardless. The label is chosen on the server from the derived unit, never taken from the client.
- *Why not store a unit id or locator:* the bound itself is what retrieval uses. D5 re-anchors it on reparse more precisely than a locator could, because a locator can be removed.

### D4. Server API
- `createConversationFn({ editionId, scope })`, where `scope` is `{ kind: "whole" } | { kind: "unit", endPosition: number }`. The server re-derives units and accepts the scope only if `endPosition` equals a current unit's end. Otherwise it returns `{ error: "stale_scope" }`, and the dialog reloads units. The repository's `createConversation` gains an optional per-edition `{ maxPosition, scopeLabel }`.
- `getReadingUnitsFn({ editionId })` gives the picker its list.
- `widenScopeFn({ conversationId, editionId, scope })` runs an `UPDATE … WHERE max_position IS NOT NULL AND max_position < $new` (or sets NULL for whole book). A zero-row update with no change means narrowing or equality, and returns `{ widened: false }`. Doing the check in the `WHERE` clause makes concurrent widens safe without a read-modify-write race.
- `getConversation` and `listConversationsForEdition` return `scopeLabel` with each book.

### D5. Re-anchoring bounds on reparse
`replaceEditionStructure` already loads old passages and computes the old-to-new match. It will also load old `position`, and it will build `rebase(oldBound)`, which returns the greatest new position among new passages matched (exact, split, or merged) from old linear passages with `position <= oldBound`. If no such passage exists, it returns `-1`, which hides everything. `ReplaceOptions` gains an optional `onReplaced(tx, { editionId, rebase })` hook, passed through the ingest deps. It is called inside the same transaction, only when the parser version changed. The job wiring in `src/server/jobs/handlers.ts` (`ingestDeps`) passes the conversation module's `rebaseScopes(tx, editionId, rebase)`, which updates every non-NULL `max_position` for that edition.

- *Why a hook:* it keeps the catalog independent of the conversation module, with the outer layer composing the two (as `src/fns/library.ts` does when it prunes conversations after deletion), while keeping the update atomic with the structure swap. Without that, a reader could briefly see a bound pointing into shifted positions.
- *Why "greatest surviving position at or before":* this is conservative by construction. If the last passage was split, only its first half is kept, which can drop a sentence of scope but never adds later text.
- Same-version re-ingests do not change positions, so they skip the hook.

### D6. Bounded outline
`getOutline` drops entries whose passage `reveal_position` exceeds the book's bound. That needs `getToc` to return the position, which is a small additive field on `TocNode`. Entries with no passage stay only if a later visible sibling or descendant remains. For a bounded book, the result includes `scope: "<label>"` and `continuesBeyondScope: true`.

### D7. Prompt
`PromptBook` gains `scopeLabel: string | null`. For a bounded book, the book list line reads `- b1: "Title" by X — the reader has read through "Chapter 22"`. The Spoilers section is chosen deterministically: if every book is whole-book, use the existing courtesy text. Otherwise, use a strict section that forbids revealing, hinting at, or speculating about anything after the stated point, including from the model's own knowledge of the book. It tells the model to say plainly when a question needs later material, and keeps the courtesy for any whole-book books. `PROMPT_VERSION` becomes `"3"`. The system prompt is built only from `conversation.books`, so it stays byte-stable until a widen.

### D8. UI
- A shared `NewConversationDialog` (in `src/components`) is used by both the book detail page and the book's conversations page. It shows a radio list of units grouped by `path` parent (for example under "Part Two"), plus "Whole book" last. Nothing is preselected and Start stays disabled until a choice is made. Long lists scroll, with no search box for now.
- Conversation header: a scope chip reading "Through Chapter 22" or "Whole book". For bounded books, a "Widen" menu lists later units and whole book. Choosing one calls `widenScopeFn` and refreshes the conversation. The control is disabled while a generation is streaming, to avoid confusion even though it would be safe (D4).
- The existing `spoiler-notice` renders only when some book is whole-book. Bounded conversations show a short note: the scope, and that the assistant may know the book from training.
- The conversation list shows the scope label, or "Whole book", next to each entry.

## Risks / Trade-offs

- [The model knows famous books from training, so a retrieval bound cannot stop it from recalling later events] → The prompt explicitly forbids using outside knowledge of later events, and the bounded notice tells the reader the limit is instructed, not guaranteed. Evaluate with a known title (for example *The Rise of Endymion* scoped mid-book, asking about the ending).
- [The heuristic picks poor units for unusual TOCs, such as *Infinite Jest*'s sparse or repeated labels] → Duplicate disambiguation, the spine fallback, and golden unit tests over the fixture EPUBs. A bad unit list degrades only granularity, not safety, because bounds are still exact positions.
- [The front/back-matter label list is English-only] → Unmatched matter becomes an extra first or last unit, which is harmless. The list can be extended later without a spec change.
- [Chapter titles in the picker can themselves be spoilers] → Accepted, since they are the book's own TOC, already shown on the detail page (see Non-Goals).
- [Widening changes the system prompt and invalidates the prompt cache once] → Expected and rare. Each scope's prompt is stable.
- [Re-anchoring can shrink a scope slightly when the bounded passage is split by a new parser] → Conservative by design. The label still shows the reader's intent, and they can widen if needed.

## Migration Plan

1. Run the additive Drizzle migration that adds `scope_label` with its check constraint. Existing rows have NULL/NULL, meaning whole book, which matches current behavior.
2. Deploy. No backfill is needed, because units are computed on demand.
3. Rollback: the old code ignores `scope_label`. Bounds that were set would still be honored by the old tools (except the outline), so rolling back is safe. The column can be dropped later.

## Open Questions

- Exact contents of the front/back-matter pattern list, and whether the fallback threshold of three units is right. Tune both against the fixture library during implementation. Neither changes the spec or the task breakdown.
