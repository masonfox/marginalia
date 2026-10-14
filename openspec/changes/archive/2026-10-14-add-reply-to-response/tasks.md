## 1. Context contract and server validation

- [x] 1.1 Define shared reply-context types, a 2,000 UTF-16-unit limit, and version-1 stored data-part helpers; verify unit cases for trimming, boundary lengths, emoji, extraction, and legacy messages with no context.
- [x] 1.2 Extend conversation HTTP and chat input validation with optional context accompanying a new message only; verify HTTP tests reject malformed IDs, empty/over-limit text, and context-only regeneration requests without writes or provider calls.
- [x] 1.3 Resolve quote sources from saved assistant messages in the target conversation before append, map invalid context to HTTP 400, and persist the versioned data part with the reader text; verify integration tests cover valid, user, foreign, missing, unsaved, and saved-incomplete sources and unchanged busy/access behavior.

## 2. Persistent history and provider replay

- [x] 2.1 Add deterministic version-1 model projection for stored quote parts, keeping the original stored parts intact; verify captured provider input contains the labeled quote and new question exactly once, including quote text resembling citation markers.
- [x] 2.2 Extend chat history/retry coverage to quoted turns, reloads, and later messages; verify stored quote snapshots survive regeneration and source-error-message removal, earlier projected messages replay unchanged, and system prompt/tool definitions remain byte-identical.
- [x] 2.3 Render quote data parts separately in optimistic and loaded user messages as escaped plain text with an assistant-response label; verify browser checks show the same quote after reload, no book-verification styling, and unchanged legacy user messages.

## 3. Selection action

- [x] 3.1 Mark eligible assistant text regions and excluded citation/control regions, and implement full-range validation/capture using persisted message IDs; verify selection cases for Markdown node boundaries, one versus multiple messages, excluded research/source/control content, whitespace, streaming, and saved incomplete responses.
- [x] 3.2 Add a viewport-clamped "Reply to selection" button and selection snapshot lifecycle; verify pointer activation preserves the selected text, keyboard selection reaches and activates the button, Escape/invalid selection dismiss it, and scroll/resize/navigation do not leave stale UI or listeners.
- [x] 3.3 Add accessible over-limit feedback and touch-selection behavior; verify exactly 2,000 units attach, 2,001 units preserve existing context with an explanation, and touch selection retains native copying while exposing the action.

## 4. Composer and submission lifecycle

- [x] 4.1 Introduce controlled reader draft and conversation-local pending quote state with preview, replace, remove, and focus behavior; verify typed text survives each quote action, quote-only send is blocked, busy send stays blocked, AI-disabled views expose no action, and navigation/reload clears pending context.
- [x] 4.2 Carry context in the optimistic user message and derive the transport payload from that submitted message; verify outgoing requests include the selected source/text, ordinary requests remain compatible, and a later pending quote cannot change a submitted turn.
- [x] 4.3 Preserve the full submission snapshot for rejected requests and reconcile persisted history before choosing resend or regeneration after ambiguous failures; verify pre-storage failure can be edited/retried with context, post-storage generation retry appends no duplicate user message, and newer draft text is not overwritten during recovery.

## 5. Integrated acceptance

- [x] 5.1 Add an end-to-end select -> attach -> ask -> stream -> reopen scenario and failed-generation retry scenario using existing browser fixtures; verify sent-history quote display, unchanged citations/research trail, actual provider context, and stable prefix assertions all pass.
- [x] 5.2 Run `pnpm typecheck`, `pnpm lint`, relevant unit/integration/browser suites, and `openspec validate add-reply-to-response --strict`; verify all required checks pass and record any manual touch/native-selection QA needed by the browser environment.

## Verification note (2026-10-14)

Implementation tasks are complete. Task 5.1 was completed afterward: the reply E2E scenario passed against this branch, and the maintainer completed manual browser QA. Task 5.2 ran typecheck, all unit tests, scoped integration tests, repository lint, scoped lint, and strict OpenSpec validation; repository lint has the known pre-existing formatting failures. See verification.md for exact results and follow-up QA.
