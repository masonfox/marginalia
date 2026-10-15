## Why

The conversation composer has grown with each feature (reply quotes, then passage references) and now gets in the way of the conversation. It is a fixed 2-row textarea with a resize handle. A 4,000-character passage preview can push the input out of view. Notices shift the layout. Send is disabled without saying why. A reload loses the draft and its attachment. All of its state lives inline in a 900-line route component, which makes it hard to change. Issue #29.

## What Changes

- Replace the bottom-edge strip with a **floating composer card** that fills the conversation column. Messages scroll under a soft fade above it.
- **Autogrowing input**: grows from one line up to about 40% of the viewport, then scrolls inside the card. The resize handle goes away. It uses `field-sizing: content` where the browser supports it and measures `scrollHeight` otherwise.
- **Send/Stop control**: one round icon button inside the card. While a reply streams it becomes Stop, in the same spot. When sending is unavailable it is dimmed and states the reason, e.g. "Type a message" or "Checking passage…".
- **Character counter**: shown only near the 8,000-character limit. **Shortcut hint line**: desktop only.
- **Unified attachment chip** for reply quotes and passage references:
  - Collapsed by default. Expands to the full text in a box capped at about 8 lines, plus "Open in book →" for passages.
  - Expand/collapse and remove controls sit on the chip itself.
  - Passage notices (checking, out of scope, bad range, other invalid) take the chip's place in the same slot.
- **Keyboard**:
  - Enter sends and Shift+Enter inserts a newline. On touch devices Enter inserts a newline and the button sends.
  - Esc removes the attachment. It does not stop a streaming reply.
- **Markdown list editing** in the plain-text input:
  - A newline on a `- `, `* ` or `1. ` line continues the list, and numbers increment. A newline on an empty item ends the list.
  - Tab and Shift+Tab indent and outdent list items. Elsewhere, Tab keeps its normal focus order.
- **Sent user messages render as Markdown**, using the existing `react-markdown` + `remark-gfm` setup with no raw HTML and no citation components. Today they render as `whitespace-pre-wrap` text. Stored message text is unchanged.
- **Draft persistence in `sessionStorage`**: the text and attachment for each conversation survive a reload and navigating away and back within the same tab. This replaces the in-memory `drafts` Map.
  - A restored passage is checked again. A restored quote is kept only if its source message still exists.
  - A `?ref=` handoff replaces a restored attachment.
  - The draft is cleared on submit and when the conversation is deleted.
- **Refactor**: move composer state into a `useComposer` hook and draft storage into `lib/composer-draft.ts`. Split the UI into `<Composer>`, `<AttachmentChip>`, `<ComposerNotice>`, `<AutogrowTextarea>` and `<SendButton>`.

The server, the stored message format, prompt assembly, quote and passage validation, and paste-link detection are all unchanged. There is still at most one attachment.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `literary-conversations`: several composer requirements change.
  - Pending context and passage references now survive a reload within the same tab session, and are checked again on restore. Previously they were local and did not survive.
  - New requirements:
    - an autogrowing message input
    - a send control that explains why it is unavailable, and becomes Stop in the same place
    - composer keyboard behavior, including Esc removing the attachment
    - Markdown list editing
    - Markdown rendering of sent user messages
    - collapsible attachment display, with notices shown in the same slot

## Impact

- **Code**:
  - `src/routes/c.$conversationId.tsx` keeps chat, send, retry and "Edit failed message", and delegates composer state and UI.
  - New `src/hooks/use-composer.ts` (or alongside the route) and `src/lib/composer-draft.ts`, plus unit tests.
  - New components under `src/components/composer/`.
  - `src/components/conversation-controls.tsx` clears the stored draft on delete.
  - User-message rendering in the route reuses the Markdown setup in `src/components/chat.tsx`.
- **Reused**:
  - `PassageQuote` and `ReplyQuote` become the chip's expanded body.
  - `checkPassageRefFn`, `parsePassageLink`, `passageContextPart`, `replyContextPart`, `attachmentKey` and `WidenScope`.
- **Tests**: new unit tests for draft storage, list editing and send state. The quote and passage tests in `e2e/app.spec.ts` are updated and extended for the redesign, reload restore and Markdown rendering.
- **No** server, API, database, dependency or environment changes. Drafts stay in the browser tab and are never sent anywhere until submitted.
