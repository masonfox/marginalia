## Why

Conversations can currently reveal any part of the book, which undermines the core use case of discussing a novel while reading it. The planned `add-reading-progress` change solved this with reader profiles and tracked progress, which is more than the problem needs. A coarse bound chosen when a conversation starts ("I've read through Chapter 22") is enough to set the context, and the plumbing already exists: `conversation_editions.max_position` is applied by every retrieval tool, but nothing ever sets it. This change lets the reader set it and defines what a "chapter" is, a unit `add-book-preprocessing` also needs.

## What Changes

- **Reading units.** Each edition gets an ordered list of reading units derived from its table of contents: the TOC flattened in reading order, using the deepest entries that point at passages and skipping front and back matter (cover, copyright, contents, acknowledgments, and similar). When the TOC is missing or too sparse to be useful, units fall back to spine sections. Each unit has a label, a start position, and an end position (the position before the next unit starts). Units are derived data and are recomputed on reparse.
- **Scope picker.** Starting a conversation asks how far the reader has read: a list of reading units plus "whole book". The choice sets that edition's `max_position` to the chosen unit's end position. "Whole book" leaves it unset.
- **Widening only.** The reader can extend a conversation's scope later, but not narrow it, because earlier replies may already contain later material.
- **Model awareness.** The system prompt states the boundary ("the reader has read through Chapter 22") and tells the model not to speculate about or reveal events beyond it, including from its own knowledge of the book, in addition to the hard retrieval bound. The outline tool is bounded too, so it no longer exposes later chapter titles.
- **Visible scope.** The conversation header and conversation list show the current scope. The existing spoiler notice is shown only for whole-book conversations. Bounded conversations show a short note that the assistant may still know the book from its training.
- **Reparse-safe.** When a book is reparsed, each conversation's bound is moved so it still covers the same text.
- Reader profiles, persistent per-reader progress, and fine-grained positions (CFI, percentages) are out of scope. They move to the BookOrbit work, which can later prefill the picker or write finer positions into the same column without a data migration.

## Capabilities

### New Capabilities
- `reading-scope`: Reading units derived per edition, choosing and widening a conversation's scope, and how the scope is shown.

### Modified Capabilities
- `literary-conversations`: Conversations are created with a scope; the spoiler notice applies only to whole-book scope; the system prompt states the boundary.
- `library-browsing`: The book detail page's conversation entry point offers the scope choice when starting a conversation.

## Impact

- **Code**: reading-unit derivation (likely in `modules/catalog` or a small new module reading `toc_entries` and `passages`), the conversation creation function and prompt builder in `modules/conversation`, and the new-conversation and chat header UI.
- **Data**: units are computed on demand from `toc_entries` and passages (no new table, no backfill). One additive column, `conversation_editions.scope_label`. No change to canonical text tables. `max_position` already exists.
- **Retrieval**: no change. Position-bounded search and resolve already exist and are already applied by the tools.
- **Known edge cases**: TOC entries that point mid-section, nested parts and chapters (*Rise of Endymion*), and TOCs with repeated or uninformative labels (*Infinite Jest*). Footnotes are already revealed at the position of their first reference, so they follow the bound.
