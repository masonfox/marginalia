# Manual verification against Anthropic

Run on 2026-10-14 against a dev server (`claude-sonnet-5-5`, `AI_PROMPT_CACHE` default on, `AI_EFFORT` unset, `AI_MAX_STEPS` 8, `AI_TEMPERATURE=0.7` left set on purpose), driven through the conversation UI with headless Chromium. Book: *The Rise of Endymion*.

## Two turns within the cache lifetime

| | Turn 1 | Turn 2 (follow-up 12 s later) |
|---|---|---|
| Question | "How does the Shrike's relationship to Aenea change over the course of the book? Find the key scenes." | "Which one of those scenes best supports reading the Shrike as her protector rather than a threat? Keep it short." |
| Steps | 8 (hit `AI_MAX_STEPS`, finish `tool-calls`) | 1 |
| Input | 102,565 | 22,776 |
| Cache read | 81,945 | 1,781 |
| Cache write | 20,602 | 20,991 |
| Uncached | 18 | 4 |
| Output (of which reasoning) | 2,594 (474) | 1,692 (756) |
| Estimated cost | $0.0857 | $0.0696 |

**Within a turn, caching works.** Turn 1 has almost no uncached input, and its cache writes (20.6k) match the size of the final step's prompt, so each step from 2 on read the whole previous prefix from cache. Unreported per step, but implied: if any later step had missed, writes would exceed the final prompt size. Without caching, turn 1 would have cost about $0.23 at Sonnet 5.5 prices (102.6k × $2 + 2.6k × $10 per MTok), so caching cut it by about 63%.

**Across turns, the newest reply misses.** Turn 2 read only 1.8k tokens (tools and system prompt) and wrote the rest. This is the reasoning-replay risk in design.md: the stored reply holds `reasoning` and `custom` parts (Anthropic's thinking and progress-update blocks), which history replay drops, so the request diverges right after the first user message. The miss is limited to the newest reply: a third turn (below) read 72.3k from cache, because turn 2's request was itself built from replayed history, which is byte-stable since `messages.parts` became `json` (design decision 9). The cost of the gap is roughly one cache write of the previous reply's tool loop per follow-up (about $0.05 here). The follow-up change that replays reasoning parts with their provider metadata would remove it.

## Other checks in the running app

- **Stopped reply.** A third message stopped after 9 s: 76,861 in (72,302 cached), 1,185 out, ~$0.03, stored with `complete = false`. The reply shows "· partial" and the header total rose from 129.6k to 207.7k tokens without a reload.
- **Provider error.** A server with an invalid API key returned HTTP 401. The failed reply has no footer, and the header gained "· 1 reply has no recorded usage" without a reload.
- **Old conversation.** A reply saved before this change shows no footer; the header reads "1 reply has no recorded usage".
- **Leftover temperature.** Each request logged one pino `warn` line, "AI provider warning", with `feature: "temperature"` and the conversation id, including the 8-step turn. No "AI SDK Warning" lines reached the console.

## Observed but out of scope

Turn 1 used all 8 steps on searches and reads and ended at the step limit, partly after its long queries failed ("Long queries fail; I'll use shorter ones."). The reply was marked incomplete. Worth revisiting with reading scope or a higher `AI_MAX_STEPS`.
