## Why

The assistant starts every conversation with no picture of the book, so it searches blind. In the first real conversation, two of four searches ("Shrike temporal time travel", "Shrike guardian protector Aenea") returned nothing because full-text search cannot match conceptual queries, and those wasted steps also added cost. Summaries and an index of characters and motifs, computed once per book with a cheap model, give the assistant a map of the book. Combined with reading scope (which fixes what part of the map a conversation may see) and prompt caching (which makes that map cheap to re-send on each step), this should make answers better and use fewer steps. This was planned as part of `add-library-providers` but does not depend on the provider abstraction, so it is split out.

## What Changes

- **Unit summaries.** For each reading unit (defined by `add-reading-scope`), generate a short summary of what happens in it. Summaries are stored with the unit's position, so the same bound that limits retrieval limits which summaries a conversation can see.
- **Position-tagged observations.** For each unit, extract observations about characters, places, objects, and motifs: what appears and what happens to it in that unit. There are no whole-book profiles. A "profile" is built at query time from observations at or before the conversation's bound, so derived data cannot leak later events.
- **No whole-book synthesis by default.** Book-level themes are not generated, since they cannot be bounded. They may be shown later only for whole-book scope.
- **Grounding.** Observations and summaries cite supporting passages by locator. Citations are checked with the existing quote verification. Unverified items are kept but marked, and the assistant is told derived data is a guide, not evidence: claims in answers must still be cited from the text.
- **Assistant integration.** The conversation's system prompt includes a compact map of unit summaries up to the bound (placed in the cached prefix), and a new tool looks up observations for a character or motif within the bound.
- **Processing.** A new `analysis.preprocess` background job (one per edition, deduplicated) runs after ingest and after reparse when preprocessing is enabled, or on demand from a button on the book detail page, which also shows progress and status. Work is split per reading unit so a failure retries only that unit.
- **Separate model.** A new optional `AI_PREPROCESS_MODEL` (same provider as `AI_MODEL`, defaulting to it) lets operators use a small model such as Claude Haiku 5.5 for bulk work. A setting controls whether preprocessing runs automatically on ingest or only on demand.
- **Provenance and staleness.** Every derived row records edition, reading unit, model, prompt version, and parser version. A reparse marks rows stale. Stale rows are not used and are regenerated.
- **Spend.** Preprocessing usage is recorded through `ai-usage` per edition, and the book detail page shows it.

## Capabilities

### New Capabilities
- `book-preprocessing`: Generating, storing, verifying, and invalidating per-unit summaries and observations; triggers; status; and bounded access.

### Modified Capabilities
- `literary-conversations`: Bounded summary map in the system prompt and an observation lookup tool, both limited to the conversation's scope.
- `ai-providers`: Optional separate model for preprocessing.
- `library-browsing`: Preprocessing status, trigger, and spend on the book detail page.
- `self-hosting`: New preprocessing environment variables documented, including cost and privacy notes (the whole book is sent to the provider).

## Impact

- **Depends on**: `add-reading-scope` (reading units, bound semantics). Uses `add-ai-cost-controls` for usage recording and prompt caching. Does not depend on library providers.
- **Code**: a new `modules/analysis` (tables, prompts, job handler, bounded queries), a new job kind in `server/jobs/kinds.ts`, an enqueue hook at the end of ingest and reparse, new tool and prompt changes in `modules/conversation`, and book detail UI.
- **Data**: new derived tables (summaries, observations, preprocessing runs) in an additive migration, cascading on edition deletion. Canonical text is untouched, consistent with the `book-structure` requirement that canonical text is separate from derived data.
- **Cost**: about 380k input tokens for a 1.5M-character novel. With a small model that is a few cents per book; with the conversation model, roughly a dollar. Automatic preprocessing of a large filesystem library should default to off or to a small model.
- **Privacy**: preprocessing sends the full text of a book to the configured provider, not just retrieved passages. Docs must say so, and the local OpenAI-compatible option still applies.
