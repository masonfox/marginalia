## Why

The first real conversation (one question about *The Rise of Endymion* on `claude-sonnet-4-5`) cost about 14 cents, and nothing in the system recorded why. From its stored parts, roughly 90% of that was input: the tool loop ran 8 steps, and each step re-sent the system prompt, the tool definitions, and every earlier tool result at full price, because prompt caching is off. Usage is not recorded at all, so cost cannot be measured, compared across models, or used to judge whether later changes (reading scope, book preprocessing) actually reduce it. This change makes AI spend visible and removes the avoidable part of it, before those changes add more AI work.

## What Changes

- Record token usage on every assistant message: input, output, cache-read, and cache-write tokens, plus reasoning tokens where the provider reports them. Usage is summed per conversation and shown in the conversation view with an estimated cost.
- Enable prompt caching for providers that support it (Anthropic first) so the stable prefix (tools, system prompt, prior turns) is billed at the cached rate on each step of the tool loop. The system prompt and tool list must be byte-stable between steps and turns for this to work.
- Add optional effort/reasoning configuration (`AI_EFFORT`) for models where reasoning cannot be disabled and is billed as output. Current Claude models think by default (Sonnet 5.5 defaults to `high` effort, Opus 5.5 to `medium`), so effort is the main lever on output spend.
- Handle sampling parameters that newer models reject: `AI_TEMPERATURE` stays optional and is documented as unsupported on current Anthropic models (Sonnet 5.5, Opus 5.5, Haiku 5.5). The API rejects it on those models; the pinned SDK already drops it with a warning, so a leftover setting is ignored and logged, not a failed request.
- Document a recommended model setup: Claude Sonnet 5.5 for conversations (cheaper per token than Sonnet 4.5 and a newer model), Opus 5.5 as the higher-quality option, and a small model for bulk work (used by `add-book-preprocessing`).
- Price data for cost estimates comes from a small table in code, which operators can override or extend with an optional `AI_PRICES` variable. Estimates are labeled as estimates, and token counts remain the authority. A model with no known price shows tokens and no cost.

### Roadmap update

This change also records a revised order for the changes after `add-literary-conversations`, replacing the list in the foundation proposal:

1. `add-ai-cost-controls` (this change): usage recording, prompt caching, model guidance.
2. `add-reading-scope`: a coarse "through chapter" bound chosen per conversation, replacing the reader-profile and progress scope of `add-reading-progress`. Fine-grained progress and reader profiles move to the BookOrbit work.
3. `add-book-preprocessing`: AI summaries and position-tagged observations per reading unit, stored apart from canonical text and bounded by reading scope. Split out of `add-library-providers`.
4. `add-library-providers` + `add-bookorbit-integration`: the provider abstraction (shaped by BookOrbit, as the foundation design intended), work/series grouping, configurable processing triggers per source, and fine-grained reading progress sync.
5. `add-interpretive-memory`: unchanged.

Changes 1 and 2 are independent and may proceed in parallel. Change 3 depends on 2 (it summarizes the reading units that 2 defines) and uses 1 to record and measure its own spend.

## Capabilities

### New Capabilities
- `ai-usage`: Recording token usage for every AI call (conversation turns now, preprocessing later), per-conversation totals, and labeled cost estimates.

### Modified Capabilities
- `ai-providers`: Prompt caching where supported, optional effort configuration, and documented handling of sampling parameters that current models reject.
- `literary-conversations`: The conversation view shows usage and estimated cost, and the prompt/tool prefix is kept stable so it can be cached.
- `self-hosting`: New and changed AI environment variables are documented, including the recommended model setup.

## Impact

- **Code**: `modules/ai` (provider options for caching and effort, price table), `modules/conversation` (`chat.ts` captures `usage` in `onFinish`, prompt stability), conversation UI (usage display), `server/config.ts`.
- **Data**: an additive migration adds an `ai_usage` table (one row per AI call, linked to its conversation and message). It is a separate table so a retried failure keeps its usage and preprocessing can reuse it. Existing messages have no usage and show as unknown.
- **Dependencies**: no new packages and no SDK bump. Verified against the pinned versions: `@ai-sdk/anthropic` 4.0.79 supports a request-level `cacheControl` provider option and knows the 5.5 models, and `ai` 7.0.138 exposes a provider-neutral `reasoning` option and reports cache-read, cache-write, and reasoning tokens in its usage type.
- **Operators**: anyone with `AI_TEMPERATURE` set should unset it when moving to current Anthropic models. Leaving it set is harmless but logs a warning.
