## Context

See proposal.md for motivation and specs/literary-conversations/spec.md for the behavior contract. The conversation route owns `useChat`, an uncontrolled textarea, and retry handling. Its transport sends only the latest user's text; `/api/chat` validates a trimmed 1-8,000-character message, and `startChat` loads authoritative history before appending it. Messages persist AI SDK parts in a JSON column. `replayableParts` currently admits text and completed tools only.

Assistant output is Markdown rendered by `AssistantText`, split into text blocks around `ResearchTrail` activity. Citation markers become interactive controls, with separate source lists, usage, and incomplete notices. Raw Markdown offsets therefore cannot reliably identify selected displayed text. The stable request prefix spec requires unchanged system/tool content and deterministic replay.

The coordinator approved one removable structured quote, persisted source ID plus displayed text, and eligibility limited to saved non-streaming replies.

## Goals / Non-Goals

**Goals:** Integrate with existing message parts, server-owned history, and retries; make selection robust across Markdown nodes; preserve draft text and citation controls; keep quote attribution separate from book evidence.

**Non-Goals:** Multiple quote attachments, response branching, persistent unsent drafts, annotations, quoting tool output or book passage popovers, editing assistant messages, or cryptographic/exact-source verification of quoted text.

## Decisions

### D1. Capture displayed text inside explicitly marked response regions

Add a selection controller scoped to the conversation view and annotate assistant text roots with their source message ID. Observe selection changes and pointer/touch completion; inspect the complete range, not only its endpoints. A valid range lies in eligible response text for one persisted message and intersects no excluded subtree. Support selections across Markdown nodes and adjacent text roots of the same message only when they cross no research/source/control content. Citation buttons/popovers and their contents are excluded; selection crossing a citation control is rejected rather than producing ambiguous quote text.

Snapshot `Selection.toString()` and the source ID before moving focus; trim only outer whitespace and preserve internal displayed whitespace. Count UTF-16 code units with JavaScript string length, matching existing request string limits. Reject over 2,000 units with an accessible explanation. Do not silently shorten the selection.

Place a real button near the selection's visible range, clamped to the viewport. Preserve the snapshot on pointer activation and focus transfer to that button; make it keyboard reachable after keyboard selection, and restore normal selection behavior on dismissal. Touch users retain native selection/copy affordances and can activate the separate button. Reposition on scroll/resize and dismiss when the selection is invalid, Escape is pressed, or the conversation changes. Clean up all event listeners. Plain tooltip text alone cannot meet activation/accessibility requirements; raw Markdown selection offsets were rejected because citation substitution changes the rendered text.

Eligibility comes from loader-confirmed stored message IDs, excluding the active streaming response. A just-finished response becomes eligible after the normal loader invalidation confirms persistence. Saved stopped/error text is eligible with its existing incomplete/error notices. Hide the action when AI is disabled because there is no composer.

### D2. Keep draft and pending quote as separate conversation-local state

Move the textarea to controlled state and store `pendingQuote: { messageId, text } | null` independently. Render an assistant-response quote preview above it with a labeled remove button. Attaching replaces only the quote and focuses the textarea; removal changes only the quote. Reset state when conversation identity changes and do not persist unsent drafts. The message still needs reader text within the existing 8,000-character limit. Quoting an older eligible response while busy can prepare context, but sending remains blocked until generation finishes.

Snapshot the text and quote together for submission. An optimistic user message carries the quote so it immediately renders in history. Once submitted, clear the active composer while retaining the submission snapshot for error recovery; if the request is rejected before persistence, restore or offer editing of that snapshot without overwriting a newer draft. Generation errors after persistence retry the saved turn. Inserting an editable blockquote in the textarea was rejected because it obscures attribution and makes removal/replacement unreliable.

### D3. Store a typed quote data part in the existing message JSON

Extend the shared UI message data types with `data-reply-context` containing `{ version: 1, messageId: string, text: string }`; store at most one such part alongside the user's text part. The server assigns the version so the stored projection format remains stable across future upgrades. The transport sends an optional `replyContext` field derived from that user message, never from mutable pending composer state. Extend HTTP and `ChatInput` validation with a UUID source ID and trimmed 1-2,000-unit text. Context without a new message is invalid; regeneration requests continue to omit message and context.

In `startChat`, after loading the target conversation and before append/provider invocation, resolve the source among its saved assistant messages. Reject unknown, foreign-conversation, user, or unsaved sources with an explicit invalid-context outcome mapped to HTTP 400. Preserve busy/not-found/access behavior. Store the reader text and quote together through the existing append transaction. Source ID validates attribution membership, not exact text authenticity: browser selection constrains normal UI input, while custom client text remains user-supplied context. No quote is promoted to evidence.

Render the data part separately in optimistic and loaded user messages as escaped, whitespace-preserving plain text labeled "Replying to assistant". Existing text extraction continues to return only the reader's text; quotation markers never invoke Markdown citation rendering. A snapshot rather than a live source lookup keeps sent quotes readable if a failed assistant message is later removed by regeneration. No source foreign key is needed. Separate database columns were rejected because JSON parts already supply persistent structured payloads; flattening quote and question into one stored text part would lose presentation and attribution.

### D4. Project quote context into model text deterministically

Before `convertToModelMessages`, transform a user's quote data part into a labeled plain text part preceding the reader's own text. The fixed wrapper states that this is user-supplied context quoting an earlier assistant response, not verified book evidence; include the source ID and selected text with explicit delimiters, then label the new reader message. Render from stored snapshots using one versioned, deterministic helper; never mutate the stored parts or earlier assistant messages. Do not place quote-specific text in `buildSystemPrompt` or tool definitions, and do not change the existing global system prefix for this feature.

The same projection is used on initial send, future turns, restarts, and retries. A request-level quote absent from persisted history would disappear on retry, so it is not acceptable. Test provider message content and prefix equality explicitly; the current generic part filter would otherwise discard the quote.

### D5. Preserve both retry paths

For failure before persistence, the current retry branch resends the last optimistic user message: extend it to carry the original data part and recoverable snapshot. If persistence succeeded and an assistant error exists, regenerate without a new message or quote, using the stored user part. Determine acceptance using refreshed authoritative history where necessary so a lost response after append does not cause an accidental duplicate through blind resend. Existing generic request idempotency is not expanded in this change; reconcile this turn before retrying it. Validate that replacing/removing a new pending quote cannot change a previous submission's retry payload.

## Risks / Trade-offs

- DOM selection and native touch menus vary by browser -> Keep native selection intact, snapshot before focus changes, and exercise pointer, keyboard, touch, scroll, and Markdown selections in browser coverage.
- Selection may cross rendered citation or research controls -> Walk the full range and reject excluded content; keep source popovers independent.
- Data parts are currently filtered from provider replay -> Add an explicit quote projection and verify it reaches the provider exactly once on every replay path.
- Custom clients can alter quote wording -> Validate source membership and limits, label all quote text as user context, and retain existing citation verification.
- Quote text adds input tokens -> Bound it to 2,000 units; existing usage accounting reports actual provider costs.
- Network errors blur submission acceptance -> Reconcile against stored history before choosing resend versus regeneration, and keep the full submission snapshot available for recovery.

## Migration Plan

No SQL migration or new package is needed. Deploy quote-aware readers, request validation, persistence, and replay together; existing messages have no quote parts and continue unchanged. Before enabling the UI, verify mixed old/new message history and no-context requests. If rollback is necessary, disable selection creation while keeping quote display and replay support for already stored messages; a full older-binary rollback would hide/filter those data parts, so retain the compatible reader path until affected data can be handled deliberately.
