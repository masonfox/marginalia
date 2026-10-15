## 1. Pure helpers

- [x] 1.1 Add `src/lib/composer-draft.ts`:
  - A versioned zod schema (`v: 1`, text ≤ 8,000, and an attachment that is a quote ≤ 2,000 chars, a passage `{ ref, snapshot }`, or null).
  - The key `marginalia:composer:<id>`.
  - `loadComposerDraft`, `saveComposerDraft` (an empty draft removes the key) and `clearComposerDraft`, with every storage access wrapped in try/catch.

  Verify with `src/lib/composer-draft.test.ts`, which covers: round trip, empty removes, malformed JSON / wrong version / over-limit discarded, and storage throwing returns null without throwing.
- [x] 1.2 Add `src/lib/list-editing.ts`. `continueList` handles `- `, `* ` and `N. `, keeps indentation, increments numbers, and ends the list when the item is empty. `indentListItem` indents or outdents by two spaces and returns null for non-list lines. Both are pure over `{ value, selectionStart, selectionEnd }`. Verify with `src/lib/list-editing.test.ts` covering each case in the "Markdown list editing" spec.

## 2. Composer components

- [x] 2.1 Create `src/components/composer/autogrow-textarea.tsx`:
  - `field-sizing: content` with a `scrollHeight` fallback when unsupported.
  - 1 line minimum, `40dvh` maximum, no resize handle.
  - Applies list edits through `execCommand("insertText")`, falling back to setting the value.

  Verify manually in Chromium and Firefox that it grows, caps and shrinks.
- [x] 2.2 Create `send-button.tsx`, a round icon button with three states:
  - send
  - stop, with `aria-label="Stop"`
  - blocked, with `aria-disabled`, `title`, an `aria-describedby` reason, and a no-op click

  Verify with a unit test on the pure `blockedReason` helper ("Type a message" / "Checking passage…" / null) and by inspecting the accessibility tree in e2e (task 5.x).
- [x] 2.3 Create `attachment-chip.tsx`:
  - An icon, a source label ("Passage from the book · Book · Section" / "Replying to assistant") and a one-line excerpt.
  - An expand toggle (`aria-expanded`/`aria-controls`) that shows `PassageQuote`/`ReplyQuote` in a scrollable box capped at about 8 lines.
  - Remove buttons ("Remove passage" / "Remove quote").
  - Keyed by `attachmentKey` so it starts collapsed.

  Verify by running `npm run typecheck` and the e2e in group 5.
- [x] 2.4 Move `PassageNotice` into `composer-notice.tsx`, and add the over-limit quote message to it. It renders in the chip slot and keeps `data-testid="passage-status"`. Verify that the existing out-of-scope and bad-range e2e tests still pass.

## 3. Composer state hook

- [x] 3.1 Create `src/components/composer/use-composer.ts`:
  - Move in `draft`, `attachment`, `notice`, the `checkSeq` guard, `attachPassage`, the `?ref=` handoff effect, and the re-attach after widening from the route.
  - Expose `attachQuote`, `removeAttachment`, `dismissNotice`, `restore`, `clear`, `canSend`, `blockedReason` and `inputRef`.

  Verify with `npm run typecheck`.
- [x] 3.2 Add persistence to the hook:
  - Load on mount and on conversation change.
  - Keep a restored quote only if its `messageId` is a saved assistant message.
  - Show a restored passage at once, then re-check it quietly with send blocked. A failure replaces it with the notice.
  - Save with a ~300 ms debounce, plus flushes on `pagehide`, conversation change and unmount.
  - Clear on `clear()`.
  - Have the handoff run after the restore so it replaces the restored attachment.

  Verify with e2e tasks 5.3–5.5.
- [x] 3.3 Remove the module-level `drafts` Map. Verify that `grep -n "new Map<string, string>" src/routes/c.\$conversationId.tsx` returns nothing.

## 4. Wire into the route

- [x] 4.1 Create `composer.tsx`, the card form:
  - Chip or notice slot, `AutogrowTextarea` with the paste-link handler, and `SendButton` in the bottom-right.
  - A character counter shown at ≥ 7,200 chars.
  - A hint line hidden under `@media (pointer: coarse)`.
  - Key handling:
    - IME guard.
    - Esc removes the attachment or dismisses the notice, and never stops.
    - Enter sends on desktop and continues the list on touch / with Shift.
    - Tab/Shift+Tab work on list lines only.
- [x] 4.2 Replace the inline form in `src/routes/c.$conversationId.tsx`:
  - Use `useComposer` + `<Composer>` in a `sticky bottom-4` container with a gradient fade above it.
  - Add bottom padding to the message list.
  - Route `ReplySelection.onAttach` and "Edit failed message" through `attachQuote`/`restore`, and keep the submit logic that builds `parts` with `clear()`.

  Verify that the route builds with `npm run typecheck` and `npm run lint`.
- [x] 4.3 Call `clearComposerDraft(conversationId)` after a successful delete in `src/components/conversation-controls.tsx`. Verify with e2e task 5.5.
- [x] 4.4 Add `UserMarkdown` in `src/components/chat.tsx` (`REMARK_PLUGINS`, `skipHtml`, no citation components, safe link attributes), and use it for user message text in the route in place of `whitespace-pre-wrap`. Verify with a unit test that renders `<img src=x onerror=…>` as text and a numbered list as `<ol>`.

## 5. End-to-end coverage (`e2e/app.spec.ts`)

- [x] 5.1 Update the existing quote and passage tests for the chip:
  - Collapsed by default.
  - Expand to see the full text and "Open in book →".
  - Remove via the chip's button.

  Verify that `npm run test:e2e` passes.
- [x] 5.2 Add a send-control test:
  - Disabled with "Type a message" when empty.
  - Stop appears in the same place while streaming.
  - Esc removes the attachment and does not stop the stream.
  - Shift+Enter on `1. item` yields `2. `.
- [x] 5.3 Add a reload test: type a draft, attach a quote, reload, and see the same draft and quote. Then send and reload, and the composer is empty.
- [x] 5.4 Add a restored-passage test: attach a passage, narrow the scope so it is out of range, reload, and the out-of-scope notice replaces the chip with the draft kept. Also cover that a `?ref=` handoff replaces a restored quote.
- [x] 5.5 Add a delete test: a draft exists, the conversation is deleted, and the storage key is gone (checked via `page.evaluate`). Add a corrupt-draft test: seed malformed JSON, open, and the composer is empty with no error.
- [x] 5.6 Add a Markdown rendering test: send a message with a numbered list and `<b>x</b>`, and the sent message shows an `<ol>` and the literal tag text.

## 6. Final checks

- [x] 6.1 Run `npm run lint`, `npm run typecheck`, `npm run test:unit` and `npm run test:e2e`, and all pass.
- [x] 6.2 Check the composer manually at 375 px width (no horizontal scroll, the hint is hidden under touch emulation, Enter inserts a newline) and in Firefox (autogrow fallback).
