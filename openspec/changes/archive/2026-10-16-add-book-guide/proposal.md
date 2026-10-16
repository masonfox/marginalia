## Why

Preprocessing produces cited, verified, position-bounded unit summaries and observations, but only the assistant sees them. The reader gets a status card. Readers can't check what the assistant "knows", can't fix it when it is wrong, and have nowhere to put their own context. Epic #28 makes the guide reader-facing: readers can **see** it, **correct** it, and **add** to it. Spoiler bounds apply to people as strictly as they apply to the model.

## What Changes

The change covers all of epic #28 (#21 to #27), delivered in phases that follow the epic's dependency graph:

```
  canonical text            immutable; locators; positions
        |
  machine layer             unit summaries + observations (unchanged, regenerable)
        |
  reader layer              durable, reader-owned, keyed by stable identity
        |                   reading position, subjects/aliases, corrections, notes
        v
  merged view --> bound(position) --> Guide UI / margin glosses / assistant
```

- **Book Guide (#21).** A read-only Guide for each book with three views. **Chapters** shows unit summaries in reading order with linked citations; unverified citations are marked. **Index** shows subjects filterable by kind, and each subject opens a timeline of its per-unit notes. **Notes** comes from #25. Provenance (model, prompt version, stale state) is shown. Nothing is shown until a bound exists. Whole-book themes are not offered.
- **Reading position (#22).** An optional, server-side, per-edition position at reading-unit granularity. It moves forward only, unless the reader explicitly moves it back. It sets the Guide's default bound and the default "as of" for reader notes. It is highlighted, never preselected, in the new-conversation picker. Conversations keep their own widen-only snapshot bounds. Widening a conversation past the position offers to update it. Reparsing re-anchors it.
- **Subjects and aliases (#23).** Durable subjects that group observation names (`name_key`). Each alias link has its own **reveal position**, because "Strider = Aragorn" is a spoiler. Merges are proposed by deterministic heuristics and apply only once the reader confirms them. Readers can merge, split, rename, and change kind in the Index. The Index, `lookupObservations`, and glosses resolve names through the aliases visible at the bound.
- **Corrections (#24).** A reader overlay that replaces or suppresses a summary or an observation. It is keyed by unit anchor locator and `name_key`, not by row id, so it reapplies after regeneration and reparse. It is flagged when the machine row has been regenerated since. It is shown as "corrected by reader" and can carry a verified citation.
- **Reader notes (#25).** Freeform markdown pages per book, optionally attached to a subject or a unit. Each carries a locator-anchored "as of" position and is visible only at or after it.
- **Margin glosses (#26).** In the passage reader, mentions of known subjects become glosses. Each gloss shows the subject's profile, corrections and notes bounded by the passage on screen. Name matching is deterministic and makes no model call.
- **Guide context in conversations (#27).** The research trail shows the bounded map a reply used and any observation and note lookups. It adds **Correct this** on guide items and **Save as note** on reply excerpts.
- **Assistant integration.** The book map and `lookupObservations` return the merged view, with reader corrections labelled. Suppressed rows are withheld. A new `lookupNotes` tool returns attributed reader notes within scope. Neither corrections nor notes are evidence, so the assistant still cites the text. `PROMPT_VERSION` is bumped.

Out of scope: parse warnings and the Reparse button (stay in #5); per-reader identity and profiles; automatic position tracking or external sync (BookOrbit/KOReader); feeding confirmed subjects back into the preprocessing prompt; model-proposed alias clustering.

## Capabilities

### New Capabilities
- `reading-position`: per-edition reading position. Covers storage, forward-only updates and explicit move-back, unset state, re-anchoring on reparse, and its role as a default but never as the authority over conversations.
- `book-guide`: the reader-facing Guide. Covers the bound choice (position or per-visit picker, plus a session-only peek), the Chapters, Index and Notes views, subject timelines, citations, and provenance.
- `guide-subjects`: subjects and aliases over observation names. Covers reveal positions, heuristic proposals, confirmation, merge, split, rename and kind, and bounded name resolution.
- `guide-corrections`: the reader overlay that replaces or suppresses machine summaries and observations. Covers stable-identity keys, reapplication after regeneration and reparse, the "regenerated since" flag, provenance, and optional verified citations.
- `reader-notes`: reader-authored guide pages. Covers attachment to subjects or units, a locator-anchored "as of" position, bounded visibility, and size limits.
- `margin-glosses`: subject mentions and gloss cards in the passage reader, bounded by the passage on screen.

### Modified Capabilities
- `literary-conversations`: the book map and observation tool return the merged, alias-resolved view with corrections labelled. Adds a reader-notes tool. Reader content is attributed and is never evidence.
- `reading-scope`: the new-conversation picker highlights the reading position without preselecting it. Widening a conversation past the position offers to update it.
- `research-trail`: guide-context steps (the bounded map, observation and note lookups), plus Correct this and Save as note actions.
- `library-browsing`: the book detail page gains the reading-position control and the Guide entry point.

## Impact

- **Database:** new tables for reading positions, subjects, subject aliases, dismissed proposals, corrections, and reader notes (Drizzle migrations). Machine tables are unchanged. Assistant messages gain a small guide-context record.
- **Modules:** a new reader-layer module beside `src/modules/analysis`. `analysis/queries.ts` gains listing and merged-view queries. The reparse hook in `src/server/jobs/handlers.ts` re-anchors reader anchors as well as conversation bounds.
- **Conversation:** `prompt.ts` (map rendering, prompt text, `PROMPT_VERSION` 6 → 7) and `tools.ts` (alias- and correction-aware `lookupObservations`, new `lookupNotes`, in fixed order). The stable-prefix rule is preserved: the map changes only when corrections in scope change.
- **UI/routes:** new Guide routes under `/books/$editionId`, a position control on the book page, glosses in `/p/$locator`, trail steps and actions in `research-trail.tsx`, and a Save-as-note action in `reply-selection.tsx`.
- **Docs:** the shared-household caveat for the instance-wide reading position.
