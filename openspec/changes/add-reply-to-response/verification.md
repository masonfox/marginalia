# Reply-to-response implementation verification

Implemented version-1 structured reply snapshots, shared trimmed 2,000 UTF-16-unit validation, source membership validation before persistence/provider calls, deterministic stored-history projection, plain-text quote rendering, saved-message selection capture, keyboard/pointer/touch action, controlled composer, and authoritative-history retry reconciliation. The system prompt and tools files are unchanged; chat.ts changes are limited to the contract, validation, persistence, and replay hooks.

Checks completed:

- `pnpm typecheck`: passed.
- `pnpm test:unit`: 19 files, 250 tests passed.
- `pnpm test:integration src/modules/conversation/chat.int.test.ts src/modules/conversation/http.int.test.ts`: 2 files, 27 tests passed.
- Scoped `pnpm exec biome check` over all 11 edited code/test files: passed.
- `openspec validate add-reply-to-response --strict`: passed.
- `pnpm lint`: failed with 148 existing repository formatting errors (including CRLF); scoped checks pass.

The new integration coverage checks malformed/context-only requests, user/foreign/missing sources, saved incomplete response acceptance, persistence, provider labeling, exactly-once quotation/question replay, regeneration without duplicate user messages, unchanged system/tools, later-turn stable replay, and quote snapshots surviving source deletion. Unit coverage checks trimming, exact boundaries, emoji, extraction, legacy messages, and immutable versioned projection.

Added an E2E scenario to the existing app fixture suite for Markdown displayed-text selection, draft preservation, structured transport, rejection-before-storage retry, stream display, and reopening persisted quote history. Its stream is mocked at the browser HTTP boundary; actual provider input is checked by integration tests.

Browser suite was NOT RUN. The coordinator explicitly directed skipping it because there is no shared fixture instance/config, and directed not to create one. OpenSpec task 5.1 remains unchecked for integrated browser acceptance; browser verification portions of implementation tasks remain outstanding.

Manual/browser QA still required: real keyboard selections and Tab/Enter activation; native touch selection/copy menu; multi-node/full-range selections crossing citation and research controls; exactly 2,000 versus 2,001 units and existing-context preservation; scroll/resize viewport clamping; selection clearing/Escape; busy/streaming and saved incomplete eligibility; navigation/reload cleanup; ambiguous network failure and newer draft protection; generation failure browser retry; unchanged sources and citations. Run the E2E suite against the documented configured fixture before archiving this change.
