## Context

All five reading-unit pickers render through `ScopeChoices` (`src/components/scope.tsx`), which draws the whole-book option, then a collapsible "partway" button, then the unit list. `NewConversationDialog` keeps `choice: Choice | null` in state, resets it to `null` on every open and close, and fetches the reading position with `["reading-position", editionId]` so that `positionChoice()` can mark it. `WidenScope` does not fetch the position at all. The reading-position card and the widen offer already invalidate that query key, so a cached position is fresh.

The position is loaded asynchronously after the dialog opens, so the preselection cannot be the initial `useState` value.

## Goals / Non-Goals

**Goals:**
- Preselect without an effect that could race with, or overwrite, a choice the reader has already made.
- One ordering change in `ScopeChoices` serves every picker.

**Non-Goals:**
- Preselecting in the reading-position dialog, the Guide bound picker, or the note anchor. Their selection behavior is unchanged. Preselecting the current value would be a no-op in the first two, and the note anchor already starts from its value.
- Expanding the partway section automatically. The collapsed row already shows "Through <label>" for the selection.
- Per-reader positions.

## Decisions

### 1. Derive the selection instead of setting it in an effect
Widen the dialog state to `Choice | null | undefined`. `undefined` means the reader hasn't touched the picker, and the shown value is the default: `positionChoice(position.data, offeredUnits)`. `null` means "explicitly nothing", and a value is the reader's own choice. Concretely: `const selected = choice === undefined ? defaultChoice : choice`. The value passed to `ScopeChoices`, `chosenLabel`, the Start button's disabled check, and submission all read `selected`.
- Opening or closing resets the state to `undefined`, so the default comes back the next time the dialog opens.
- A stale-units error sets `null`. The spec says the reader is asked to choose again, so the default must not silently reappear against the new units.
- *Alternative:* a `useEffect` that calls `setChoice` once the position loads. Rejected because it needs a guard so it doesn't clobber a click made before the query settles, and it renders a disabled Start for a frame.

`positionChoice` already returns `"whole"` for a finished position, and `null` when the position's unit isn't among the units it is given. Passing it the passage-filtered units (`offered?.units ?? units.data`) covers the passage cases with no new logic.

### 2. Widen uses the same helper against the later units
`WidenScope` adds the `["reading-position", book.editionId]` query (enabled while open) and uses the same `undefined`/`null`/value state. The default is `positionChoice(position.data, later)`. `later` holds only units past the current bound, so a unit position at or before the bound yields `null`. A finished position yields `"whole"`, which is always offered when widening. The dialog also passes `position` to `ScopeChoices`, so the position is marked here as well. No change is needed for the "update my reading position" offer: `offersPositionUpdate` already returns false when the new scope doesn't go past the position.

### 3. Reorder inside `ScopeChoices`
Render the partway button and its unit list first, and the whole-book `Option` last. Every caller gets the new order. Update the component's doc comment, which currently says "'Whole book', then…" and "Nothing is preselected".

### 4. Don't repeat the label when the selection is the position
When the selected unit is also the reader's position, the collapsed row shows "Through <label>" plus a "Your reading position" line instead of repeating the label twice. When they differ, both labels are shown as they are today.

## Risks / Trade-offs

- [A Start click without reading the scope commits a scope that can only widen] → The row shows "Through <label>" and the scope notice (or the spoiler notice for whole book) appears above Start. The position is only ever a value the reader set themselves on this single-reader instance.
- [Finished position preselects whole book, the most permissive scope] → Accepted on purpose. The spoiler notice is shown before Start.
- [The position query fails or is slow] → `position.data` is undefined, so the default is `null`. The dialog behaves as it does today: nothing is selected and Start is disabled.
