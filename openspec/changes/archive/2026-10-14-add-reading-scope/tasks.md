## 1. Reading units

- [x] 1.1 Add a pure `deriveReadingUnits` in `src/modules/catalog/reading-units.ts` implementing leaf units, any-depth boundaries, reading-order sorting, leading/trailing matter filtering, path labels, and duplicate disambiguation (design D1, D2). Verify with unit tests for a flat chapter list, nested parts with part title pages, a mid-section entry, out-of-order entries, entries sharing a passage, repeated labels, and a "Notes" chapter mid-book that is kept.
- [x] 1.2 Add the spine-section fallback (fewer than three TOC units → linear sections, "Section N" labels). Verify with unit tests for no TOC and a TOC with only Cover/Title/Copyright.
- [x] 1.3 Add `getReadingUnits(db, editionId)` that loads TOC entries with passage positions and linear sections, then calls the pure function, and export it from `#/modules/catalog`. Verify with an integration test over a fixture EPUB, and that units change after a reparse that alters the TOC.

## 2. Scope storage and API

- [x] 2.1 Add `scope_label` to `conversation_editions` with a both-null-or-both-set check, and generate the migration with `pnpm db:generate`. Verify the migration applies with `pnpm db:migrate` and that existing rows read as whole book.
- [x] 2.2 Extend `createConversation`/`createConversationForEdition` to accept a per-book scope, validated server-side against current units, returning a stale-scope error otherwise. Return `scopeLabel` from `getConversationBooks` and `listConversationsForEdition`. Verify with integration tests for unit scope, whole book, and stale `endPosition`.
- [x] 2.3 Add `widenConversationScope` using a conditional `UPDATE` that only moves the bound later or to NULL (design D4). Verify with integration tests: widen to a later unit, widen to whole book, narrowing rejected, whole-book rejected, and equal scope is a no-op.
- [x] 2.4 Add `getReadingUnitsFn`, extend `createConversationFn` with `scope`, and add `widenScopeFn` in `src/fns/conversations.ts`. Verify with `pnpm typecheck` and the existing `http.int.test.ts`/`service.int.test.ts` still passing.

## 3. Reparse re-anchoring

- [x] 3.1 In `replaceEditionStructure`, load old positions, build `rebase(oldBound)` from the old-to-new passage match, and call an optional `onReplaced(tx, { editionId, rebase })` hook inside the transaction when the parser version changed (design D5). Verify with catalog integration tests for shifted positions and a removed bounded passage (bound never moves later).
- [x] 3.2 Add `rebaseScopes(tx, editionId, rebase)` in the conversation module and wire it through `ingestDeps` in `src/server/jobs/handlers.ts`. Verify with an integration test: a conversation bounded at a chapter end is reparsed under a new parser version, its bound covers the same text, and its label is unchanged.

## 4. Model-facing behavior

- [x] 4.1 Bound `getOutline` by reveal position (add position to `TocNode`), and add `scope` and `continuesBeyondScope` for bounded books. Verify in `tools.int.test.ts` that no entry after the bound is returned and that unbounded outlines are unchanged.
- [x] 4.2 Add `scopeLabel` to `PromptBook`, state the scope per bounded book, switch the Spoilers section deterministically between strict and courtesy text, and bump `PROMPT_VERSION` to `"3"` (design D7). Verify in `prompt.test.ts` that bounded and whole-book prompts differ as specified and that the same books produce byte-identical output.
- [x] 4.3 Pass `scopeLabel` from `conversation.books` into `buildSystemPrompt` in `chat.ts`. Verify in `chat.int.test.ts` that a bounded conversation's system prompt names the scope and that a generation started before a widen keeps its bound.

## 5. UI

- [x] 5.1 Build `NewConversationDialog` (units grouped by parent, whole book last, nothing preselected, Start disabled until chosen, stale-scope reload) and use it on the book detail page and the book's conversations page. Verify manually in `pnpm dev` with a nested-TOC book, and that cancelling creates nothing.
- [x] 5.2 Add the scope chip and Widen menu (later units plus whole book, disabled while streaming) to the conversation header in `src/routes/c.$conversationId.tsx`. Verify manually that widening updates the chip and that earlier units are not offered.
- [x] 5.3 Show the whole-book spoiler notice only when some book is whole-book, and show the bounded note otherwise, on both the conversation view and the new-conversation flow. Show each conversation's scope in the book's conversation list. Verify manually and with `data-testid` assertions.
- [x] 5.4 Extend `e2e/app.spec.ts` to start a conversation with a chapter scope and see "Through …" in the header and list. Verify the Playwright suite passes.

## 6. Wrap-up

- [x] 6.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`, and verify all pass.
- [ ] 6.2 Spoiler smoke test against a real provider: scope a well-known novel mid-book and ask about its ending. Verify the reply declines to describe later events and no tool result contains passages past the bound. Record the result in the PR.
