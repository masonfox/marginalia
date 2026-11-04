## 1. Picker order

- [x] 1.1 In `ScopeChoices` (`src/components/scope.tsx`), render the partway button and unit list before the whole-book option, and update its doc comment. Verify with a `scope.test.ts` case that the partway button precedes the "Whole book" radio in DOM order.
- [x] 1.2 When the selected unit is the reader's position, show "Through <label>" plus "Your reading position" in the collapsed row without repeating the label (design D4). Verify with a `scope.test.ts` case that the label appears once.

## 2. New-conversation preselection

- [x] 2.1 In `NewConversationDialog`, change the `choice` state to `Choice | null | undefined` and derive `selected` from `positionChoice(position.data, offered?.units ?? units.data)` while it is `undefined`. Use `selected` for the picker value, `chosenLabel`, Start's disabled state, and submission. Reset to `undefined` on open and close, and set `null` on a stale-units error.
- [x] 2.2 Update `scope.test.ts`: reverse "marks the position's unit without selecting it" and "marks whole book … still unselected" so the position is checked and Start is enabled. Add a case where the position comes after the starting passage and is preselected. Keep "marks nothing" for an unset position and for a position before the passage, with Start disabled. Add a case where the reader picks another unit and that unit is the one submitted. Verify with `npm test` (scope tests pass).

## 3. Widen preselection

- [x] 3.1 In `WidenScope`, add the `["reading-position", book.editionId]` query (enabled while open). Apply the same `undefined`/`null`/value state with the default `positionChoice(position.data, later)`, and pass `position` to `ScopeChoices` for marking. Verify with unit tests for: a position later than the bound (preselected), a finished position (whole book preselected), and a position at or before the bound or unset (nothing selected, Widen disabled).

## 4. End-to-end

- [x] 4.1 Update `e2e/app.spec.ts` flows that set a position and then open the new-conversation or widen dialog. Expect the preselected choice and an enabled Start or Widen, and only expand the partway section when choosing a different unit. Verify with the Playwright suite passing.
- [x] 4.2 Manually check the book page with a position set: "Start conversation" opens with the position selected and the partway row first, and Start works without any further clicks.
