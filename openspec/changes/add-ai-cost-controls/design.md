## Context

See proposal.md for motivation. The current state that shapes the approach:

- `modules/ai` maps `AiConfig` to an AI SDK model and carries `maxSteps` and `temperature`. It has no database access.
- `modules/conversation/chat.ts` runs `streamText` with tools and `stopWhen: stepCountIs(maxSteps)`, and persists the assistant message in `createUIMessageStream`'s `onEnd`, which runs on finish, stop, and error. Usage is never read.
- A retry deletes the failed assistant message (`prepareHistory`), so anything stored only on that message is lost.
- The system prompt (`buildSystemPrompt`) depends only on the conversation's books, and the three tool definitions have static descriptions. The prefix is already stable in practice. Nothing tests for it.
- History is replayed through `replayableParts`, which keeps text, step markers, and finished tool calls, and drops reasoning parts.
- Pinned SDKs (checked in `node_modules`): `@ai-sdk/anthropic` 4.0.79 accepts `providerOptions.anthropic.cacheControl` and sends it as Anthropic's request-level `cache_control` (automatic caching of the last cacheable block). It knows `claude-sonnet-5-5`, `claude-opus-5-5`, and `claude-haiku-5-5`, and drops `temperature` with a warning on models that reject sampling parameters. `ai` 7.0.138 has a provider-neutral `reasoning` call option (`provider-default | none | minimal | low | medium | high | xhigh | max`) that the Anthropic provider maps to `thinking`/`effort`. Its `LanguageModelUsage` reports `inputTokenDetails.{noCacheTokens, cacheReadTokens, cacheWriteTokens}` and `outputTokenDetails.reasoningTokens`.

## Goals / Non-Goals

**Goals:**
- One usage record per AI call, in a shape `add-book-preprocessing` can write to without a schema change to conversations.
- Caching on by default for Anthropic, with a test that catches prefix drift.
- Effort configurable with no provider-specific code in the app.

**Non-Goals:**
- Spending limits, budgets, or alerts. This change only measures.
- Reconciling with provider invoices or fetching live prices.
- Per-reader accounting. Marginalia is single-instance with shared access.
- Explicit cache breakpoints, the 1-hour cache TTL, or mid-conversation system messages.
- Changing what history is replayed. See the reasoning-parts risk below.

## Decisions

### 1. Usage lives in its own ledger table, not on `messages`

A new `ai_usage` table holds one row per AI call: `id`, `purpose` (`conversation` for now), `conversation_id` (FK, cascade, nullable), `message_id` (FK, `ON DELETE SET NULL`, nullable), `provider`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens` (all nullable integers, null meaning "not reported"), `steps`, `complete` (boolean), `created_at`. It is indexed on `conversation_id` and `message_id`.

Why not a `usage` jsonb on `messages` (the proposal's first idea): a retry deletes the failed message, and the spec requires that attempt's usage to stay in the conversation total. With `ON DELETE SET NULL`, the row survives and still counts toward the conversation. Preprocessing will add its own nullable owner column (edition or run) to the same table instead of inventing a second store. Columns instead of jsonb because totals are `SUM` queries.

The table and its queries live in a new `modules/usage` (schema, `recordUsage`, `usageForConversation`, pricing). `modules/ai` keeps its no-database rule.

### 2. Accumulate per step and persist in `onEnd`

`streamText`'s `onStepFinish` adds each completed step's `usage` into a running total kept in the `generate` closure. `onEnd` (which already persists the message) writes the `ai_usage` row in the same `try` block, after `appendMessage`, with `message_id` set to the new message. `complete` is false when the reply was aborted or failed.

Why not `result.totalUsage`: it rejects or never resolves on abort, and the spec needs partial usage for stopped replies. Summing per-step usage gives the same total on success and the right partial total otherwise. Summation treats a field as unknown only if every step left it unknown. Otherwise missing steps count as zero.

`cache_read_tokens` and `cache_write_tokens` come from `inputTokenDetails`. `input_tokens` stores the SDK's `inputTokens` (the total, including cached), so "cached share" is `cache_read / input`. The cost formula uses `noCache = input − cacheRead − cacheWrite`.

### 3. Cost is computed at read time from a price table

`modules/usage/pricing.ts` holds a built-in table keyed by model id, in USD per million tokens: `input`, `output`, `cacheRead`, `cacheWrite`. The built-in entries cover the current Anthropic models and `claude-sonnet-4-5` (for existing conversations), copied from Anthropic's pricing page at implementation time. Other providers are left to `AI_PRICES`. Lookup is exact model id, then the longest table key that is a prefix of the id (for dated snapshots). Reasoning tokens are already included in `outputTokens`, so they are not added again.

`AI_PRICES` (optional JSON) is parsed and validated in `server/config.ts`: `{"<model>": {"input": n, "output": n, "cacheRead"?: n, "cacheWrite"?: n}}`. It merges over the built-in table. A missing cache price falls back to the input price, which over-estimates and never under-estimates.

Cost is computed when usage is read, not stored. This keeps the table the single source and lets a corrected price fix old estimates. The trade-off is that a provider price change also rewrites history, which is acceptable for a labeled estimate. Haiku 5.5's higher price above 100K-token prompts is not modeled. Conversation requests stay far below that.

### 4. Caching is a request-level provider option

`createAi` builds a `providerOptions` object once, and `chat.ts` passes it to `streamText`. For Anthropic with caching on, that is `{ anthropic: { cacheControl: { type: "ephemeral" } } }`. Anthropic then caches up to the last cacheable block of each request, so step N+1 reads everything step N sent, and a follow-up turn within 5 minutes reads the earlier history. OpenAI and Google cache automatically above their minimum lengths and report it in the same usage fields. OpenAI-compatible endpoints get nothing.

`AI_PROMPT_CACHE` (boolean, default `true`) turns it off.

Alternatives: explicit breakpoints on the system prompt and the last tool result (more control, more code, and the 4-breakpoint limit to manage). Request-level caching covers the whole prefix with one option, and the system prompt plus tools (about 2K tokens) clears the minimum cacheable length on current models.

### 5. Effort uses the provider-neutral `reasoning` option

`AI_EFFORT` accepts `none | minimal | low | medium | high | xhigh | max`. Unset means `provider-default`. The value goes to `streamText({ reasoning })`, so the app has no per-provider effort code. The provider library handles models that don't support a level (it maps, clamps, or drops it with a warning). On Sonnet 5.5, for example, `none` cannot become `thinking: disabled`, which the API rejects.

### 6. SDK warnings go to the app log

`onStepFinish` also receives the step's `warnings`. The first time a given warning text appears in a request, it is logged at `warn` through the app logger with the conversation id. This is where a leftover `AI_TEMPERATURE` or an unsupported effort level shows up. The SDK's own console warning output is turned off (`globalThis.AI_SDK_LOG_WARNINGS = false` at startup) so it isn't logged twice.

### 7. Usage reaches the UI through the conversation query

The conversation detail returned by the server function gains `usage` per assistant message (joined from `ai_usage` by `message_id`) and a `usageTotal` for the conversation (`SUM` by `conversation_id`, plus a count of assistant replies with no usage row). Both include the computed estimate or `null`. The chat view already refetches or updates the conversation when a stream ends. That refetch now also covers stopped and failed replies, so the totals update without a reload and with no new stream part type.

Display: the chat header shows the total next to the model name, e.g. `48.2k tokens · ~$0.07 est.`. Each reply gets a quiet footer line, e.g. `31.0k in (27.4k cached) · 1.2k out · ~$0.02`, with a "partial" marker when `complete` is false. Numbers are rounded for reading. The exact figures are in a tooltip.

### 8. Prefix stability is enforced by a test

A unit test builds the system prompt and tool definitions twice for the same books, serializes them as the provider would see them, and asserts they are identical. It also asserts that the tool order is fixed. An integration test with a mock model asserts that the `system` and `tools` passed on step 1 and step 2 of a loop, and on two turns, are equal. A real-provider check (cache-read tokens > 0 on step 2) is part of the manual verification task, not CI. The integration test also asserts that the second turn's messages begin with exactly what the first turn's last step sent.

### 9. Message parts are stored as `json`, not `jsonb`

Found while writing the decision 8 test: `jsonb` reorders object keys (shorter keys first), so a tool result replayed from storage serialized differently from the one the model was first sent, and every follow-up turn missed the cache from its first tool result on. `messages.parts` becomes `json`, which keeps the text as written. Nothing queries inside `parts`, so no jsonb operators are lost. `citations` stays `jsonb`, since it is never replayed to the model. Replies stored before the migration keep their reordered keys and miss the cache on replay; new replies replay exactly.

## Risks / Trade-offs

- [Reasoning parts are dropped from replayed history, so the prefix on turn 2 differs from what turn 1's last steps sent after the first assistant message.] → Cache reads on a follow-up turn will cover tools, system, and history only up to the point where the replay diverges. Within one turn's tool loop the SDK sends reasoning itself, so steps are unaffected. The manual check measures cross-turn cache reads. If they are poor, or if a current model rejects edited history (preserved thinking on accounts created after 2026-08-31), a follow-up change replays reasoning parts with their provider metadata. This is out of scope here because it changes stored-message handling.
- [Built-in prices go stale.] → Every display labels the cost an estimate, `AI_PRICES` overrides any entry, and token counts are stored exactly.
- [5-minute cache TTL expires while a reader pauses between messages.] → The first step of a later turn pays a cache write again. This is still cheaper than today, where every step pays full price. The 1-hour TTL is a later option once usage data shows the gap pattern.
- [A failed `ai_usage` insert in `onEnd` could hide a saved reply's cost.] → It runs inside the existing try/catch, after the message is saved, and logs on failure. The reply is never lost because of usage recording.
- [`onStepFinish` does not fire for a step cut off mid-stream.] → That step's tokens are unrecorded, which the spec allows. `complete = false` flags it.

## Migration Plan

1. The additive migration creates `ai_usage`. No backfill: existing replies show "no recorded usage". A second migration changes `messages.parts` from `jsonb` to `json` (decision 9).
2. Deploy. Caching is on by default for Anthropic. Operators can set `AI_PROMPT_CACHE=false` to restore the old behavior.
3. Rollback: revert the code. The `ai_usage` table can stay, since nothing else reads it.

## Open Questions

- Whether to show the conversation total on the per-book conversation list as well. This is a display addition that can follow once real numbers exist.
