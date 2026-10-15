## Context

See proposal.md for motivation. The relevant current state:

- The passage view (`src/routes/p.$locator.tsx`) renders a whole section as `PassageBlock`s, each carrying `data-locator`. The route accepts `?hl=start-end`, which `parseHighlight` reads as character offsets into the target passage's `text` and renders as a `<mark>`. Verified citations already link here with that format (`passageLink` in `src/components/chat.tsx`).
- The reply-to-response feature (`src/lib/reply-context.ts`, `src/components/reply-selection.tsx`) already sets the pattern this change follows. A versioned `data-reply-context` UI message part is stored with the user message, validated in `startChat` before persistence, and projected into a labelled text part by `projectReplyContext` when history is converted for the model. Retry and edit recovery compare `replyContextOf(parts)`.
- Scope is enforced by `book.maxPosition` against each passage's `revealPosition` (`src/modules/conversation/tools.ts`). Reading units come from `getReadingUnits`, each with an `endPosition`. The unit containing a passage is the first unit whose `endPosition >= revealPosition`.
- `resolveLocator` follows superseded locators and distinguishes `removed` from `not_found`.

## Goals / Non-Goals

**Goals:**
- One reference format (the passage view URL) shared by copy, paste, and in-app navigation.
- Book text in a reference is always server-derived and scope-checked, so it can be shown and replayed as book evidence.
- Reuse the reply-context pipeline (part, validation, projection, recovery) instead of adding a parallel one.

**Non-Goals:**
- Recognising passage links typed by hand or embedded in longer pasted text. Only a paste that is exactly one link is recognised.
- More than one attachment per message, or attaching several passages at once.
- Multi-book conversations beyond what already exists. A reference must belong to one of the conversation's books.
- Changing the system prompt, the tools, or citation verification.

## Decisions

### Reference format is the passage view URL
A reference is `{ locator, range? }`, serialised as `/p/<locator>` with an optional `?hl=<start>-<end>`. A new client-safe module, `src/lib/passage-ref.ts`, defines it:
- `passageRefSchema`: zod, with a locator matching the epub `LOCATOR` shape and a range of non-negative integers where `end > start`.
- `parsePassageLink(text, origin)`: accepts an absolute URL whose origin equals `origin`, or a root-relative path. It returns a `PassageRef` or null.
- `passageHref(ref)`
- The `data-passage-context` part helpers: `passageContextPart`, `passageContextOf`, `projectPassageContext`.

*Alternative considered:* a custom `marginalia://` scheme or an opaque token. Rejected because the URL already works in a browser, and citations already produce it.

### Range offsets come from the DOM text of the passage body
`PassageBlock` wraps the passage text in an element marked `data-passage-text`, separate from the notes `<details>`. Selection capture follows the `captureReplySelection` model: both range endpoints must sit inside the same `data-passage-text` element. Offsets are computed by measuring a `Range` from the element's start to each endpoint (`range.toString().length`), which stays correct when the existing `<mark>` splits the text nodes. Leading and trailing whitespace is trimmed by adjusting the offsets. The DOM text equals `passage.text`, because `whitespace-pre-line` only affects rendering, so the offsets are valid for `hl`. A unit test enforces this invariant.

### One action surface on the passage view
A small, focusable "Reference" button appears on each passage (visible on hover or focus, and always visible on touch widths) and opens a menu with the three options. A floating action for text selection reuses the same menu, built from the `ReplySelection` positioning code. Both actions share one `PassageReferenceMenu` component that takes a `PassageRef`.
- "Copy link" writes `origin + passageHref(ref)` with `navigator.clipboard` and confirms through an `aria-live` region.
- "Add to a conversation" lazily loads `listConversationsFn` and shows each title with its scope label. Out-of-scope conversations stay listed: blocking and offering widen happens in the conversation, on the same path a pasted link takes.
- "Discuss in a new conversation" opens `NewConversationDialog` with a `passage` prop.

The view needs `ai.enabled` (`getAiStatusFn`) and the passage's `revealPosition`. `SectionPassage` gains `revealPosition`, and the route loader fetches AI status alongside the view.

### Handoff from the passage view to the conversation by search params
Both conversation options navigate to `/c/$conversationId?ref=<locator>&hl=<s-e>`. The conversation route gets `validateSearch`. On mount it runs the attach-time check for `ref`, then removes the params with `navigate({ search: {}, replace: true })`, so a reload does not re-attach. This keeps one attach path for paste and navigation and needs no client storage.

*Alternative considered:* passing the reference in router state. Rejected because it does not survive opening in a new tab and is harder to test.

### Attach-time check as a server function, re-checked on send
`checkPassageRefFn({ conversationId, ref })` returns one of the following:
- `{ status: "ok", snapshot }`
- `{ status: "out_of_scope", editionId, unitLabel }`
- `{ status: "invalid", reason }`, where `reason` is one of `not_found | removed | not_in_conversation | bad_range | too_long`

`checkPassageRef(db, conversation, ref)` in `src/modules/conversation/passage-ref.ts` implements the check:
1. `resolveLocator` (current locator, edition, section title, passage).
2. Membership in `conversation.books`.
3. Range validated against the current `passage.text`.
4. Referenced text, either `text.slice(start, end)` or the whole passage, trimmed and at most 4,000 characters (`PASSAGE_REF_LIMIT`).
5. `revealPosition <= book.maxPosition`. When this fails, it finds the containing unit with `getReadingUnits` to build `unitLabel`.

`startChat` calls the same function, so the attach-time result is only for UX and the server re-validates on send. The HTTP body gains `passageRef: passageRefSchema.optional()`, with a refine that rejects it together with `replyContext` and requires `message`. New `ChatStart` statuses map to HTTP responses:
- `invalid_passage` → 400
- `passage_out_of_scope` → 409, with `{ error, unitLabel }`

The client shows the out-of-scope message and renders `WidenScope` for that book inline in the composer notice.

*Alternative considered:* trusting a client-supplied snapshot. Rejected because the snapshot is replayed as book evidence and must be in scope.

### Stored snapshot part: `data-passage-context` v1
The stored data is `{ version: 1, locator, range?, editionId, bookTitle, sectionTitle, text }`, written by the server in `prepareHistory` in place of the reply-context part. Because it is a snapshot, display and replay do not change after a reparse. The link uses the stored locator, and the passage view forwards it.

`projectPassageContext` prepends a text part to the user message:

```
The reader is referring to this passage from <bookTitle> (<sectionTitle>), locator <locator>. It is quoted from the book.
<referenced-passage locator="...">
...text...
</referenced-passage>
New reader message:
```

`toUIMessage` composes both projections: `projectReplyContext(projectPassageContext(parts))`. Since the part is replayed byte for byte from storage, the stable prefix holds. The model can cite `locator` with a quote from the text, and `verifyCitations` handles that unchanged because the passage is within scope.

### Composer attachment state
`pendingQuote` becomes `pendingAttachment: { kind: "quote", quote } | { kind: "passage", snapshot } | null`, so the two kinds replace each other by construction. The `onPaste` handler on the textarea calls `parsePassageLink(clipboardText.trim(), location.origin)`. On a match it calls `preventDefault()` and runs the check, and while the check runs a small "Checking passage…" status shows. Submission sends `passageRef: { locator, range }` from the snapshot. The UI message parts carry the snapshot so the optimistic message renders the same as the stored one. The retry and edit recovery comparisons change from `replyContextOf` to a combined `attachmentKey(parts)`. A shared `PassageQuote` component renders the snapshot in the composer and in history: serif book styling, a book and section label, and a link to `passageHref`.

### Scope dialog constraint
`NewConversationDialog` gains an optional `passage?: { ref: PassageRef; revealPosition: number }`. When present, it filters `units` to `endPosition >= revealPosition`, shows "This passage is in <label>.", and on success navigates with `ref` and `hl`. No choice is preselected, and server-side scope validation is unchanged. If no unit ends at or after the passage's reveal position, only "whole book" is offered.

## Risks / Trade-offs

- **[Risk]** DOM text offsets drift from `passage.text` if passage rendering changes, for example when inline markup is added later. → **Mitigation:** a unit test asserts that the offset helper's result matches `text.slice`. The server re-validates every range, and when a range fails the client falls back to attaching the whole passage with a notice.
- **[Risk]** A `hl` copied before a reparse may not fit the forwarded passage. → **Mitigation:** the server rejects it as `bad_range`, and the client offers to attach the whole passage instead.
- **[Risk]** Clipboard writes need a secure context, and self-hosted instances on plain HTTP over the LAN may not have one. → **Mitigation:** fall back to selecting the URL in a read-only input so the reader can copy it by hand.
- **[Trade-off]** Only an exact single-link paste is recognised. This is predictable and never mangles prose, but a link typed by hand stays text. The proposal records this as a non-goal.
- **[Trade-off]** One attachment per message keeps the composer and the server simple, at the cost of not being able to quote a response and reference a passage together.

## Migration Plan

No schema migration. Message parts are JSON, and messages without the new part render and replay as before. Rollback is a code revert. Stored `data-passage-context` parts would then be ignored by `replayableParts` and the renderer, and the question text would remain.
