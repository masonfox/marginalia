## 1. Reference format and message part

- [x] 1.1 Add `src/lib/passage-ref.ts` with `passageRefSchema`, `PASSAGE_REF_LIMIT` (4,000), `parsePassageLink(text, origin)`, and `passageHref(ref)`. Verify with unit tests covering absolute same-origin URLs, root-relative paths, `hl` ranges, other origins, links inside longer text, and malformed locators and ranges.
- [x] 1.2 Add the `data-passage-context` v1 helpers (`passageContextPart`, `passageContextOf`, `projectPassageContext`) and a combined `attachmentKey(parts)`. Verify that unit tests show the projection's labelled text with the locator, that parts without context are left untouched, and that invalid stored data is ignored.

## 2. Server validation and persistence

- [x] 2.1 Add `revealPosition` to `SectionPassage` in `getSectionView`. Verify that the retrieval integration test asserts it.
- [x] 2.2 Implement `checkPassageRef(db, conversation, ref)` in `src/modules/conversation/passage-ref.ts`. It covers resolution with superseded forwarding, book membership, range bounds, the 4,000-character limit, and the scope check with the containing unit's label. Verify with integration tests for each outcome: ok, superseded→current, not_found, removed, not_in_conversation, bad_range, too_long, and out_of_scope with label.
- [x] 2.3 Expose `checkPassageRefFn` in `src/fns/conversations.ts`. Verify that a call from an unauthenticated session is refused by the existing guard, as for the other conversation functions.
- [x] 2.4 Extend the chat body (`passageRef`, exclusive with `replyContext`, requiring `message`), `ChatInput`, and `startChat` to re-run `checkPassageRef` before persistence. Map `invalid_passage` to 400 and `passage_out_of_scope` to 409 with `unitLabel`. Verify with HTTP and chat integration tests that each rejection stores no message and makes no provider call.
- [x] 2.5 Store the server snapshot part in `prepareHistory`, and compose `projectPassageContext` into `toUIMessage`. Verify with integration tests that the provider receives the labelled passage with an unchanged system prompt and tools, that a retry replays the snapshot once without a new user message, and that a citation to the referenced locator verifies.

## 3. Conversation composer

- [x] 3.1 Replace `pendingQuote` with a `pendingAttachment` union. Update reply-selection attach, submit, retry, and "Edit failed message" to use it and `attachmentKey`. Verify that the existing reply-to-response tests still pass.
- [x] 3.2 Add the shared `PassageQuote` component (book and section label, serif text, link to `passageHref`), and render it in the composer preview with a remove control and in sent and reloaded user messages. Verify with a component test and a Playwright check that the history link opens the passage view highlighted.
- [x] 3.3 Add the textarea `onPaste` handler. It recognises a single passage link, calls `preventDefault`, runs `checkPassageRefFn`, shows a checking status, and attaches the reference or explains the failure while preserving the draft. Verify with Playwright: pasting a link attaches a reference and inserts no text, and pasting prose with a link inserts it unchanged.
- [x] 3.4 Show the out-of-scope notice naming the unit, with inline `WidenScope` for that book. Verify with Playwright that the passage can be attached after widening.
- [x] 3.5 Add `validateSearch` for `ref` and `hl` on `/c/$conversationId`. Attach on mount, then strip the params with a replace navigation. Verify with Playwright that the reference attaches once and a reload does not re-attach it.

## 4. Passage view actions

- [x] 4.1 Wrap passage text in a `data-passage-text` element and add a selection-to-range helper that measures offsets with `Range` and trims whitespace. Verify with a unit test (jsdom) that the offsets match `passage.text.slice` with and without an existing `<mark>` highlight, and that selections spanning passages or notes return null.
- [x] 4.2 Build `PassageReferenceMenu` (Copy link with a clipboard fallback and live confirmation, Discuss in a new conversation, Add to a conversation listing titles and scopes). Show only Copy link when AI is disabled. Verify with a component test of the option sets.
- [x] 4.3 Add the per-passage reference button (shown on hover, focus, and touch) and the floating selection action, with Escape and selection-clear dismissal. Load AI status in the route loader. Verify with Playwright keyboard and pointer flows.
- [x] 4.4 Add the `passage` prop to `NewConversationDialog`. It filters units to those ending at or after the reveal position, names the containing unit, preselects nothing, and navigates with `ref` and `hl`. Verify with a component test of the filtered choices and a Playwright flow from passage view to composer.
- [x] 4.5 Wire "Add to a conversation" to navigate to the chosen conversation with `ref` and `hl`. Verify with Playwright that the draft in an already-open conversation is kept and that out-of-scope picks show the widen notice.

## 5. Wrap-up

- [x] 5.1 Run `pnpm` lint, typecheck, unit, integration, and e2e suites. Verify that all pass.
- [ ] 5.2 Do a manual browser acceptance pass on desktop and touch widths: copy link, paste link, selection range, new conversation, existing conversation, out-of-scope then widen, retry. Record the result in this file.

## Verification notes

5.1 (2026-10-14): typecheck passes. Unit: 23 files, 275 tests passed. Integration: 17 files, 190 passed, 1 skipped. E2E: 16 passed, 1 skipped (the oversize-upload check, which skips at the default upload limit). The E2E run used an isolated dev server on its own PostgreSQL container with the Standard Ebooks fixture and configured AI; the chat endpoint is stubbed in the passage tests, so the provider was never called. Lint passes for every changed file. `pnpm lint` over the whole repository still reports formatting errors in untouched files, because this Windows checkout uses CRLF line endings (`core.autocrlf`); the files' content is unchanged.

An automated check at a phone viewport (Pixel 7) confirmed the per-passage action is visible without hover, the page has no horizontal overflow, and the "Add to a conversation" list stays on screen. This does not replace 5.2.

5.2: pending. It needs the maintainer's manual pass on desktop and touch widths.
