## 1. Configuration

- [x] 1.1 Add `AI_EFFORT` (enum `none|minimal|low|medium|high|xhigh|max`, optional), `AI_PROMPT_CACHE` (boolean, default `true`), and `AI_PRICES` (optional JSON of per-model `input`/`output`/`cacheRead?`/`cacheWrite?` USD per MTok, non-negative numbers) to `src/server/config.ts` and `AiConfig`. Verify with config unit tests: valid values parse, an unknown effort and malformed or negative `AI_PRICES` each fail with an error naming the variable, and the API key never appears in the output.
- [x] 1.2 Add the three variables to `.env.example` with one-line comments. Verify by reading the file.

## 2. Provider runtime

- [x] 2.1 Extend `AiRuntime` in `src/modules/ai/index.ts` with `reasoning` (from `AI_EFFORT`, `undefined` when unset) and `providerOptions` (`{ anthropic: { cacheControl: { type: "ephemeral" } } }` for Anthropic with caching on, otherwise empty). Verify with `ai.test.ts` cases: Anthropic with caching on, Anthropic with caching off, OpenAI (no options), and effort pass-through.
- [x] 2.2 Turn off the SDK's console warning output at startup (`AI_SDK_LOG_WARNINGS = false`), next to where `createAi` is called. Verify that a dev run with `AI_TEMPERATURE` set on a 5.5 model logs the warning once through pino (task 4.3) and not on the console.

## 3. Usage store and pricing

- [x] 3.1 Create `src/modules/usage/schema.ts` with the `ai_usage` table (design decision 1), register it in `src/server/db/schema.ts`, and generate the migration with `pnpm db:generate`. Verify the generated SQL creates only the new table, its FKs (`conversation_id` cascade, `message_id` set null), and indexes, and that `pnpm db:migrate` applies it.
- [x] 3.2 Implement `addUsage` (per-step summation where a field stays null only if every step left it null) and `recordUsage(db, row)`. Verify with unit tests for summation, including mixed reported and unreported fields.
- [x] 3.3 Implement `src/modules/usage/pricing.ts`: the built-in table (current Anthropic models and `claude-sonnet-4-5`, prices copied from Anthropic's pricing page and the source noted in a comment), merge with `AI_PRICES`, exact-then-longest-prefix lookup, and `estimateCost(usage, model)` using `noCache = input − cacheRead − cacheWrite`, with cache prices falling back to the input price. Verify with unit tests: known model, dated snapshot id, unknown model returns `null`, override wins, missing cache price falls back.
- [x] 3.4 Implement `usageForConversation(db, conversationId)` returning per-message usage keyed by message id, the conversation total (including rows whose message was deleted), and the count of assistant replies without usage. Verify with an integration test covering a retried failure (row kept after its message is deleted, still counted in the total) and a pre-change reply (counted as missing).

## 4. Chat integration

- [x] 4.1 In `src/modules/conversation/chat.ts`, pass `reasoning` and `providerOptions` to `streamText` and accumulate `usage` in `onStepFinish`. Verify with a `chat.int.test.ts` case using a mock model that the options reach the model call.
- [x] 4.2 In `onEnd`, after `appendMessage`, write the `ai_usage` row with `message_id`, provider, model, step count, and `complete = !(aborted || failure)`, inside the existing try/catch. Verify with integration tests: a finished multi-step reply stores summed usage; an aborted reply stores the completed steps with `complete = false`; a provider error stores a row, and after a retry that row has `message_id = null` and still counts.
- [x] 4.3 Log step `warnings` through the app logger at `warn`, once per distinct warning per request, with the conversation id. Verify with a mock model that emits a warning on each of two steps: one log line.
- [x] 4.4 Add the prefix-stability tests (design decision 8): the system prompt and serialized tool definitions are identical across two builds for the same books and tool order is fixed (unit test), and a mock-model loop sees equal `system` and `tools` on step 1, step 2, and a second turn (integration test). Verify both pass.
- [x] 4.5 Store `messages.parts` as `json` instead of `jsonb` (design decision 9) so replayed tool results keep their key order, with a generated migration. Verify with the 4.4 integration test asserting that the second turn replays the first turn's messages byte for byte.

## 5. Conversation UI

- [x] 5.1 Return per-message `usage` (with estimate or `null`, and `complete`) and `usageTotal` (tokens, estimate, count of replies without usage) from the conversation detail server function. Verify with an integration test of the server function response, and check it contains no configuration secrets.
- [x] 5.2 Show the conversation total in the chat header next to the model name, labeled as an estimate, with a note when some replies have no recorded usage. Verify in the running app.
- [x] 5.3 Add a quiet usage footer to each assistant reply (input with cached share, output, estimated cost, exact figures in a tooltip, "partial" marker when incomplete, nothing for replies without usage). Verify in the running app with a finished reply, a stopped reply, and an old reply.
- [x] 5.4 Confirm the existing `onFinish` → `router.invalidate()` in `src/routes/c.$conversationId.tsx` also runs after a stop and after an error, and add the refetch if it does not. Verify in the running app that the totals update without a reload in all three cases.

## 6. Documentation

- [x] 6.1 Update the AI section of `docs/deployment.md`: add `AI_EFFORT`, `AI_PROMPT_CACHE`, and `AI_PRICES` to the variable table; mark `AI_TEMPERATURE` as ignored on current Anthropic models; change examples from `claude-sonnet-4-5` to `claude-sonnet-5-5`; add a "Choosing a model and controlling cost" subsection covering the recommended setup (Sonnet 5.5 for conversations, Opus 5.5 for higher quality, Haiku 5.5 for bulk work), starting effort `medium` with `low` worth trying, how caching works, where to see usage in the app, and that costs are estimates. Verify each `self-hosting` scenario in this change against the text.
- [x] 6.2 Record the revised roadmap order from the proposal where the foundation roadmap lives, if it is kept outside the archived foundation proposal. Verify the list matches the proposal. (No roadmap is kept outside the archived foundation proposal, so this change's proposal is the record; archived artifacts were left unchanged.)

## 7. Verification

- [x] 7.1 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`, and verify all pass. (typecheck and all 363 tests pass. `pnpm lint` reports only formatter errors from CRLF line endings in this Windows working copy (`core.autocrlf=true`); with LF endings, as committed, every file is clean.)
- [x] 7.2 Manual check against Anthropic with `claude-sonnet-5-5`: ask one question that takes several tool steps, then a follow-up within 5 minutes. Record the step count, input, cache-read, cache-write, output, and estimated cost of both replies in the change folder (`verification.md`). Verify cache-read tokens are non-zero from step 2 on, and note how much of the follow-up's prefix was cached (the reasoning-replay risk in design.md).
