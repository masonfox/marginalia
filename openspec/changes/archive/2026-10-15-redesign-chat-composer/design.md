## Context

See proposal.md (Why) for the motivation and specs/literary-conversations/spec.md for the requirements.

All composer logic lives inline in `src/routes/c.$conversationId.tsx` (~930 lines). That includes:
- `draft` and `pendingAttachment` state
- `passageStatus` (checking, out_of_scope, invalid) and the `checkSeq` race guard
- the `?ref=`/`hl` handoff effect
- the re-attach after widening scope
- the paste handler
- a module-level `drafts` Map that keeps text only, not the attachment

The route also owns chat streaming, retry, and "Edit failed message", which writes into the draft and attachment. `ReplySelection` attaches quotes through a callback. Sent user messages render as `whitespace-pre-wrap` text with `AttachmentPreview` above.

There are no client hooks directories yet; helpers live in `src/lib`, and components in `src/components`. Vitest covers `src/lib` units, and Playwright covers the composer flows in `e2e/app.spec.ts`.

## Goals / Non-Goals

**Goals:**
- Make the composer state testable in isolation: draft storage and list editing as pure functions, and composer state as one hook.
- Keep the route responsible for chat transport, and stop it from managing composer internals.
- Keep the existing e2e test IDs where practical (`passage-quote`, `reply-quote`, `passage-status`), so the current tests change minimally.

**Non-Goals:**
- No change to the server, the message parts format, `checkPassageRefFn`, or the prompt.
- No rich-text editing. The input stays a `<textarea>`.
- No new dependencies.

## Decisions

### 1. Module layout
```
src/lib/composer-draft.ts          zod schema, key, load/save/clear (pure + storage wrapper)
src/lib/list-editing.ts            pure text transforms for smart lists
src/components/composer/
  use-composer.ts                  hook: draft, attachment, notice, passage checking, persistence
  composer.tsx                     card, keyboard, paste, hint, counter
  attachment-chip.tsx              quote | passage, collapsible
  composer-notice.tsx              checking | out_of_scope | invalid (moved PassageNotice)
  autogrow-textarea.tsx            sizing + list-editing keydown
  send-button.tsx                  send | stop | disabled-with-reason
```
The hook lives next to its only consumer rather than starting a new `src/hooks` directory.

`useComposer(conversationId, { messages, books, aiEnabled })` returns:
- `draft`, `setDraft`
- `attachment`, `notice`
- `attachQuote(quote)`, `attachPassage(ref)`, `removeAttachment()`, `dismissNotice()`
- `restore({ text, attachment })`, which replaces "Edit failed message" handling and keeps the current `current || …` semantics
- `clear()`, which runs on submit
- `canSend` and `blockedReason`
- `inputRef`

The route builds `parts` from `attachment` exactly as today.

Alternative: a reducer-only module with no hook. Rejected, because the async check sequence and effects (handoff, re-check after widening, persistence) belong together, and the hook keeps them together.

### 2. Draft storage format
Key: `marginalia:composer:<conversationId>`. Value:
```
{ v: 1, text, attachment: { kind: "quote", messageId, text } | { kind: "passage", ref, snapshot } | null }
```
- `ref` is the original `PassageRef` used for the re-check.
- `snapshot` is the `PassageSnapshot` returned by the last successful check.
- The schema is validated with zod, reusing `passageRefSchema`, the snapshot schema, and the 2,000-character quote limit from `reply-context`.
- Every `sessionStorage` access goes in try/catch, and any failure falls back to no persistence.
- Writes are debounced (~300 ms) and also flushed on `pagehide`, on conversation change, and on unmount. Without the conversation-change flush, the in-route navigation from one conversation to another would leak a pending write.
- An empty draft (no text, no attachment) removes the key instead of writing it.

Alternatives:
- `localStorage`: rejected. Drafts would leak across tabs and outlive the session, and the issue scopes them to the tab.
- IndexedDB: overkill for this.

### 3. Restore order and precedence
On mount, or when `conversationId` changes:
1. Increment `checkSeq`.
2. Load the draft.
3. Apply the text.
4. Apply the attachment:
   - **Quote**: keep it only if `messageId` is among the saved assistant message IDs. Today's `savedAssistantIds` provides these, passed in.
   - **Passage**: set the attachment from the snapshot immediately, set an internal `rechecking` flag, and call `checkPassageRefFn` with the stored `ref`. Use the same sequence guard as `attachPassage`.
     - Success: refresh the snapshot, since a reparse may have moved the locator.
     - Failure: drop the attachment and set the matching notice.

   No "Checking passage…" notice replaces the chip during this re-check. Only `blockedReason` reflects it, so the restore is quiet.

The `?ref=` handoff effect runs after the restore and calls `attachPassage`, so the handoff replaces whatever was restored. Both run in the same effect ordering, and the handoff effect still clears the search params. Once the handoff attaches, the draft saves the new attachment, so a reload restores it from storage rather than re-running the handoff. This matches the modified scenario.

Restore blocks sending during the re-check. Alternative: allow sending and let the server reject. Rejected, because the reader would hit a post-send error with a recovery round trip, while the check usually takes well under a second.

### 4. Clearing on delete
`conversation-controls.tsx` calls `clearComposerDraft(id)` after a successful delete. This only clears the current tab. Other tabs' sessionStorage is unreachable and harmless, because the conversation 404s there.

### 5. Autogrow
- CSS: `field-sizing: content; min-height: 1lh-equivalent; max-height: 40dvh; overflow-y: auto; resize: none`.
- Where `CSS.supports("field-sizing", "content")` is false (Firefox), a layout effect on value change sets `height = auto` and then `height = min(scrollHeight, maxPx)`.

Feature-detecting avoids double-sizing in Chromium and Safari.

### 6. Keyboard and list editing
`list-editing.ts` exports pure functions over `{ value, selectionStart, selectionEnd }`:
- `continueList(state) → edit | null`
- `indent(state, dir) → edit | null`

An edit is `{ replaceStart, replaceEnd, insert, caret }`.

`autogrow-textarea` applies an edit through `document.execCommand("insertText")` after setting the selection, so it lands in the native undo stack. If that fails, it falls back to setting the value plus the `onChange` caller, which loses undo, as the spec allows ("where the browser supports it").

Key handling order in `onKeyDown`:
1. Ignore when `e.nativeEvent.isComposing` is set.
2. Escape: remove the attachment, or dismiss the notice. Never stops the generation.
3. Enter:
   - Shift+Enter, or Enter on a touch device, tries `continueList`, else uses the default newline.
   - Enter on desktop sends when `canSend`, and otherwise calls `preventDefault` and does nothing.
4. Tab or Shift+Tab: only when the caret line is a list item. Otherwise the browser default applies.

Indent unit: two spaces. Numbered continuation parses `^(\s*)(\d+)\. ` and emits `n+1`. Lists are not renumbered after the caret, to keep the transforms simple.

Touch detection uses `matchMedia("(pointer: coarse)")`, read in an effect so SSR renders the desktop variant. The hint line is hidden with a CSS `@media (pointer: coarse)` rule, so it never flashes on mobile.

### 7. Send button
A round icon `Button` (`size="icon"`):
- Send icon when idle.
- Square icon with `aria-label="Stop"` while `busy`.

When blocked:
- The button uses `aria-disabled="true"` rather than `disabled`, so it stays focusable and the tooltip can show.
- `title={reason}` and `aria-describedby` point to a visually-hidden span with the reason.
- The click handler no-ops.

Reasons: "Type a message" and "Checking passage…".

Submission stays a form `onSubmit`, so Enter and the button share one path.

### 8. Attachment chip
`AttachmentChip` takes `{ attachment, onRemove }` and holds local `expanded` state. It is keyed by `attachmentKey` so that a new attachment resets to collapsed.

- **Header row:** icon (book or quote), the source label, the expand toggle (`aria-expanded`, `aria-controls`), and remove (`aria-label="Remove passage" | "Remove quote"`).
- **Collapsed:** a one-line `truncate` excerpt.
- **Expanded:** the existing `PassageQuote` or `ReplyQuote` inside `max-h-[8lh] overflow-y-auto`. `PassageQuote` already contains "Open in book →".

The `data-testid` values stay on the inner components. For collapsed state, the chip root carries `data-testid="attachment-chip"` and `data-kind`.

`ComposerNotice` is the moved `PassageNotice` plus the over-limit quote message, rendered in the same slot. Chip and notice are mutually exclusive, and a notice takes precedence. "Attach the whole passage" and `WidenScope` stay as they are.

### 9. Layout
The `<main>` column stays `max-w-3xl`. The composer form becomes `sticky bottom-4` with a rounded `Card` surface. A `pointer-events-none` gradient above it (`bg-gradient-to-t from-background`) is the fade. The message list gets bottom padding equal to the card height, and the scroll-to-bottom anchor stays. Sticky positioning avoids measuring and portal work, and keeps the existing document scroll.

### 10. User message Markdown
Extract a `UserMarkdown` component in `chat.tsx` that reuses `REMARK_PLUGINS` with no custom citation components and `skipHtml`. react-markdown already escapes HTML unless `rehype-raw` is used, and `skipHtml` makes the intent explicit. Links get `target`/`rel` like assistant links. The route replaces `whitespace-pre-wrap` text with it, and `AttachmentPreview` stays above.

## Risks / Trade-offs

- **Stale snapshot.** A restored chip briefly shows a stale snapshot before the re-check. → Send is blocked until the check finishes, and a failing check replaces the chip with a notice.
- **Swallowed Enter.** `execCommand("insertText")` is deprecated, though still universally supported. → The fallback path keeps the feature working without undo.
- **Raw Markdown.** Reader text that was never meant as Markdown, like `*` or `_` in prose, now renders as formatting. → This was accepted in the issue. Stored text is unchanged, so the effect is display only.
- **Sticky composer on short mobile viewports.** With the on-screen keyboard open, a 40dvh input plus an expanded chip could fill the screen. → The chip expands only on demand and is capped at about 8 lines, and `dvh` tracks the keyboard-resized viewport.
- **Mobile Esc.** Touch keyboards rarely have Esc. → The chip's remove button covers that case.
- **Quota or private mode.** sessionStorage writes can throw on quota or in private mode. → Everything is wrapped in try/catch, and the worst case is no persistence.

## Migration Plan

Client-only. The old in-memory Map holds nothing worth migrating. Rolling back means redeploying the previous build, and leftover `marginalia:composer:*` keys are ignored by it.
