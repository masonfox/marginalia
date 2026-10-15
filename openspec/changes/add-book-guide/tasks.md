## Phasing

Phases follow the epic's dependency graph and each one can merge on its own: 1 (anchors, the foundation) → 2 (#22 position) and 3 (#21 Guide) → 4 (#23 subjects) → 5 (#24 corrections) and 6 (#25 notes) → 7 (#26 glosses) → 8 (#27 and assistant integration) → 9 (wrap-up). Assistant behavior and `PROMPT_VERSION` change only in phase 8. Every phase ends with `pnpm typecheck`, `pnpm lint`, and the relevant `pnpm test:unit` / `pnpm test:integration` runs passing.

## 1. Foundation: guide module and anchors

- [x] 1.1 Create `src/modules/guide` (index, schema, queries) and register its schema in the db schema barrel. Verify that `pnpm typecheck` passes.
- [x] 1.2 Add a pure `buildForward(old, matches, newPassages)` to `catalog/persist.ts`. It forwards a locator to its match, or to the next surviving passage when the passage was removed, and never moves earlier. Verify with unit tests covering exact, moved, merged, and removed passages, and the "never earlier" property.
- [x] 1.3 Extend the `ReplacedHook` payload with `forward` alongside `rebase`, and pass it from `replaceEditionStructure`. Verify that `ingest.int.test.ts` reparse tests still pass and that a new test asserts the hook receives a working `forward`.
- [x] 1.4 Add a per-request reading-unit helper that maps unit ordinal to its start locator and checks end positions against machine rows. Verify with an integration test on a fixture EPUB.

## 2. Reading position (#22)

- [x] 2.1 Add the `reading_positions` table (same shape and check as `conversation_editions`, cascade on edition delete) and generate its migration with `pnpm db:generate`. Verify that the migration applies in the integration DB.
- [x] 2.2 Implement `getReadingPosition`, `setReadingPosition` (validated against current units; a move back requires an explicit flag), and `clearReadingPosition`. Verify with integration tests: set, forward move, a move back rejected without the flag, a stale unit rejected, finished, and clear.
- [x] 2.3 Add `rebaseReadingPositions(tx, editionId, rebase)` and call it from the `onReplaced` hook in `server/jobs/handlers.ts`. Verify with an integration test that a reparse that shifts positions keeps the position on the same text and label.
- [x] 2.4 Add server functions for get, set, and clear position in `src/fns/guide.ts`, behind the access guard. Verify that unauthenticated calls are rejected in an integration test.
- [x] 2.5 Add the position card to `books.$editionId.tsx`, reusing `ScopeChoices`: Not set, Finished, or a unit label, with the move-back confirmation dialog and the shared-instance caveat. Verify in the running app (`/run`) by setting, advancing, moving back, and clearing.
- [x] 2.6 Highlight (without preselecting) the position's choice in `NewConversationDialog`, with no highlight when it is excluded by a starting passage. Verify with a component test and in the app.
- [x] 2.7 After a successful widen past the position, or while it is unset, show "Also update my reading position?" in `conversation-controls.tsx`, and only change the position on accept. Verify in the app that decline leaves the position unchanged and accept moves it.

## 3. Book Guide, read-only (#21)

- [x] 3.1 Implement the merged-view core in `guide/queries.ts`: bounded summaries and observations over the analysis queries, with a correction-merge hook that is a no-op until phase 5. Verify with integration tests for a bound inside a unit and for stale rows hidden.
- [x] 3.2 Add a listing query for the Index: distinct names with kind, unit count, and first appearance at a bound. Verify with an integration test that a subject first seen after the bound is not listed.
- [x] 3.3 Add `getSubjectTimeline` (observations of a subject ref at a bound, in reading order). Verify with an integration test.
- [x] 3.4 Add Guide server functions (`getGuideChapters`, `listGuideSubjects`, `getGuideSubject`, `getGuideProvenance`) that validate the requested bound against current units. Verify with an integration test that a bound not matching a unit is rejected.
- [x] 3.5 Create the layout route `/books/$editionId_/guide`, which holds the visit bound in React context. It defaults to the position, shows a picker with nothing preselected when the position is unset, offers a peek with a spoiler confirmation, and supports "back to my position". Verify in the app that a reload after a peek returns to the position.
- [x] 3.6 Build the Chapters view: summaries, citation links to `/p/$locator`, unverified markers, "not yet summarized" units, and a provenance line. Verify in the app and with a component test for the unverified marker.
- [x] 3.7 Build the Index view (kind and name filters) and the subject timeline route `index/$subjectRef`. Verify in the app on a preprocessed fixture.
- [x] 3.8 Add the Guide entry point on the book detail page (ready editions only), and the empty state when there is no current preprocessing. Verify in the app.

## 4. Subjects and aliases (#23)

- [x] 4.1 Add the `guide_subjects`, `guide_subject_aliases` (one primary per subject), `guide_dismissed_proposals`, and `guide_gloss_exclusions` tables and their migration. Verify that the migration applies.
- [x] 4.2 Implement `resolveSubjects(editionId, bound)`, covering implicit refs, reveal visibility, and display name at a bound. Verify with unit and integration tests for Strider/Aragorn before and after reveal, and for a chosen display name that would spoil.
- [x] 4.3 Implement the merge, split, rename (display key from the subject's names), kind override, and alias removal mutations, including the reveal rule "keep the later of the alias's own and the merge's". Verify with integration tests for each, and confirm that observation kinds are unchanged.
- [x] 4.4 Implement deterministic proposals (same kind, containment of significant tokens, stop and honorific list, excluding linked and dismissed pairs, capped at 50) and dismissal. Verify with unit tests for Brawne/Brawne Lamia, honorifics, and dismissed pairs.
- [x] 4.5 Route the Index and timeline through `resolveSubjects`. Verify that an integration test of a timeline across aliases returns the observations in reading order.
- [x] 4.6 Re-anchor alias reveal positions in `guide.reanchor` via `forward`, and call it from the `onReplaced` hook. Verify with an integration test that a removed reveal passage moves to the next surviving passage.
- [x] 4.7 Add Index UI for proposals (confirm or dismiss), merge with an editable reveal anchor and spoiler warning, split, rename, and kind. Verify in the app.

## 5. Corrections (#24)

- [x] 5.1 Add the `guide_corrections` table and its migration, unique on (edition, target, unit locator, name key). Verify that the migration applies.
- [x] 5.2 Implement the replace, suppress, and remove correction mutations. Store the machine-text fingerprint, and verify the optional citation with `retrieval/verify.ts`, restricted to the unit's passages. Verify with integration tests that include a rejected citation from outside the unit.
- [x] 5.3 Implement the merge in the merged-view core: replaced text and citation, suppressed rows omitted, the `regeneratedSince` flag, and no effect when the machine row isn't current. Verify with integration tests for "reapplied after regeneration" and "bounded like the row".
- [x] 5.4 Add a "keep" action that refreshes the fingerprint. Verify with an integration test that the flag clears.
- [x] 5.5 Re-anchor corrections in `guide.reanchor`, setting `detached` when the forwarded locator no longer starts a unit. Verify with integration tests for a shifted unit (applies) and a merged unit (detached).
- [x] 5.6 Build the shared correction dialog component, and add Guide UI for "corrected by reader" labels, "show hidden" with restore, the "regenerated since" review, and a detached-corrections list. Verify in the app.

## 6. Reader notes (#25)

- [x] 6.1 Add the `reader_notes` table (with the attachment check and `source_conversation_id` `SET NULL`) and its migration. Verify that the migration applies.
- [x] 6.2 Implement note create, update, and delete with limits (title ≤ 200, body ≤ 20,000), the as-of kinds (unit, passage, end), and default anchor resolution from the position. Verify with integration tests for limits and defaults.
- [x] 6.3 Implement bounded `listNotes` (Guide bound, conversation bound, passage bound; end-of-book only for a null bound), plus by-subject (through `resolveSubjects`) and by-unit queries. Verify with integration tests that include "theory written after finishing".
- [x] 6.4 Re-anchor note anchors in `guide.reanchor`, never earlier, clearing unit attachments that no longer start a unit. Verify with an integration test.
- [x] 6.5 Build the Notes view, the note editor routes (`notes/new`, `notes/$noteId`) with an anchor picker and safe Markdown rendering (no raw HTML), and attached notes in Chapters and timelines. Verify in the app and with a component test that raw HTML is not rendered.
- [x] 6.6 Extend the book deletion confirmation to mention notes and guide edits when any exist. Verify in the app and with a test of the count function.

## 7. Margin glosses (#26)

- [ ] 7.1 Implement `glossesFor(editionId, passages)`. It resolves at the maximum bound, filters per passage bound, compiles case-sensitive whole-word Unicode matching longest-first (minimum length 3, minus exclusions), and returns the first mention per subject. Verify with unit tests for word boundaries, case, the first chapter (no glosses), and exclusions.
- [ ] 7.2 Implement `getGlossCard(subjectRef, passageLocator)` with the passage's bound: display name, kind, the 3 most recent merged observations, and visible attached notes. Verify with an integration test that a jump ahead uses that passage's position and excludes the current unit.
- [ ] 7.3 Render gloss marks in `passage-text.tsx` and the card popover in `p.$locator.tsx`, with a link to the subject in the Guide. Add an on/off toggle (persisted in `localStorage` inside try/catch) and a "don't gloss this name" action. Verify in the app.

## 8. Assistant integration and conversation trail (#27)

- [ ] 8.1 Switch `chat.ts` to the merged map. Render reader corrections with a `source` attribute inside the existing escaped block, and omit suppressed units. Verify with prompt unit tests for a corrected summary, a suppressed summary, a correction beyond scope leaving the map byte-identical, and escaping of reader text.
- [ ] 8.2 Update the `lookupObservations` tool to use `resolveObservations` (alias-aware, corrections applied) and to return `subject`, `observedAs`, and `source`. Verify with `tools.int.test.ts` cases for an alias revealed or unrevealed within scope, and for a corrected observation.
- [ ] 8.3 Add the `lookupNotes` tool, last in the fixed order. It has list and query modes, caps of 20 titles, 5 notes, and 2,000 characters, an attribution wrapper, and refuses other books. Verify with integration tests that include a note beyond scope being withheld.
- [ ] 8.4 Add the corrections and notes trust paragraph to the system prompt and bump `PROMPT_VERSION` to `"7"`. Verify that the prefix tests (`prefix.test.ts`) assert identical prompts and tools across turns.
- [ ] 8.5 Add the `messages.guide_context` column and its migration. Store `{ editionId, scopeLabel, mapFingerprint }` per book when a map is sent. Verify with a `chat.int.test.ts` assertion.
- [ ] 8.6 Prepend a guide step in `lib/research-trail.ts` from `guideContext`, excluded from the counts. Add a server function returning the current merged summaries and fingerprint for "changed since". Verify with `research-trail.test.ts` cases, including older messages without context.
- [ ] 8.7 Make observation and notes lookup steps readable (name, resolved subject, count, correction markers, note links). Verify with `tool-details`/`research-trail` unit tests.
- [ ] 8.8 Add "Correct this" on the guide step and observation items, using the shared correction dialog. It is not offered for deleted books or rows that aren't current. Verify in the app that the next reply's lookup returns the corrected text while the earlier stored result is unchanged.
- [ ] 8.9 Add "Save as note" to `reply-selection.tsx`. It opens the note editor prefilled with the quoted excerpt, a conversation link, and the conversation's scope anchor, with a book choice for multi-book conversations, and nothing is saved until the reader confirms. Verify in the app.

## 9. Wrap-up

- [ ] 9.1 Add an end-to-end Playwright flow: set the position, open the Guide, merge an alias, correct a summary, write a note, see a gloss, and see the guide step in a conversation (AI stubbed as in the existing e2e setup). Verify that `pnpm test:e2e` passes.
- [ ] 9.2 Document the Guide, the reading position, and the shared-instance caveat in the README and self-hosting docs. Verify that the docs render and link correctly.
- [ ] 9.3 Run the full suite (`pnpm typecheck && pnpm lint && pnpm test`) and `openspec validate add-book-guide --strict`. Verify that all pass.
