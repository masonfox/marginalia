## Why

When a book has a reading position, the new-conversation dialog only marks it. The reader still has to open "I'm partway through" and choose the same chapter again before Start is enabled, which repeats something they already told the app. The rule was there to guard against a shared position that another reader had moved forward. That is not a concern for a single-reader instance, and the scope notice already states the chosen scope above Start. The picker also lists "Whole book" first, so the choice that can spoil comes before the spoiler-safe one.

## What Changes

- The new-conversation dialog preselects the choice that matches the book's reading position: the unit, or "whole book" when the position is finished. Start is enabled right away. With no position, or when the position's choice is not offered, nothing is preselected and Start stays disabled until the reader chooses.
- A conversation started from a passage preselects the position when its unit is among the offered choices (the passage's unit or a later one).
- The widen-scope dialog preselects the position when it is later than the conversation's current scope for that book (a later unit, or "whole book" when finished). Widening to it makes no "update my reading position" offer, because the position already matches.
- In every reading-unit picker, the partway choice comes first and the whole-book choice comes last. This applies to the new-conversation, widen, reading-position, Guide bound, and note "Written as of" pickers.
- **BREAKING (behavior)**: removes the rule that the reading position is "highlighted, never preselected" in the new-conversation picker.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reading-scope`: starting a conversation preselects the reading position instead of preselecting nothing, and this includes conversations started from a passage. Widening preselects the position when it is later than the current scope. Every scope picker lists the partway choice before "whole book".

## Impact

- `src/components/scope.tsx`: the order in `ScopeChoices`, the initial choice in `NewConversationDialog`, and the initial choice in `WidenScope`, which now has to fetch the reading position.
- The other `ScopeChoices` callers (`reading-position.tsx`, the Guide route, and `guide-notes.tsx`) get the new order but keep their selection behavior.
- Tests: `src/components/scope.test.ts` (the "marks without selecting" cases are reversed) and `e2e/app.spec.ts` (flows that open the partway section or check a radio before Start).
- No server, API, or data changes. Server-side scope validation is unchanged.
