## 1. Shared foundations

- [x] 1.1 Extract `useReadingPosition(editionId)` from `ReadingPositionCard` (position, units, progress, save with move-back and stale handling, clear) and make `ReadingPositionCard` use it; verify `reading-position.test.ts` still passes and a new unit test covers progress (unit index of count, passage share, finished = full, unset = none)
- [x] 1.2 Add `previewText(raw)` in `src/lib/` that removes `[[cite …]]` markers and markdown syntax and collapses whitespace; verify unit tests for emphasis, links, headings, lists, code fences, citation markers, and literal HTML
- [x] 1.3 Extend `listConversationsForEdition` with a lateral subquery returning the latest message text that has a non-empty text part (by `seq`, capped at 600 chars), and pass it through `previewText`; verify a repository test covers latest assistant text, a failed latest reply falling back to earlier text, and an empty conversation
- [x] 1.4 Add the shadcn `DropdownMenu` component to `components/ui` and verify it renders and opens from the keyboard in a component test

## 2. Book layout route and tabs

- [x] 2.1 Turn `books.$editionId.tsx` into a layout route (loader, header, tab bar, `<Outlet/>`) and move the Discuss content into `books.$editionId.index.tsx`; verify `/books/$id` renders header and Discuss with `aria-current="page"` on Discuss
- [x] 2.2 Build the book header: cover, title, authors, import status/error when not ready, reading position control and progress bar via `useReadingPosition`, with phone and desktop-rail layouts per design §2; verify setting the position from the header updates the label and bar without reload
- [x] 2.3 Add `books.$editionId.contents.tsx` with the table of contents and in-book search (`?q=`), and redirect `/books/$id?q=` to it in the index route's `beforeLoad`; verify the existing e2e search test passes against `/books/$id/contents?q=` and the old URL redirects
- [x] 2.4 Add `books.$editionId.about.tsx` with description, facts (wrapping long identifiers), sources, parser version, and `DeleteBook`; verify the delete e2e flows pass from the About tab
- [x] 2.5 Rename the `books.$editionId_.guide*` route files to nest under the layout, remove `GuideFrame`'s back link and heading, and keep the bound bar and Chapters/Index/Notes nav; verify `tsc` passes, all existing guide URLs load inside the book layout, and the Guide tab is current on every `/guide/*` path
- [x] 2.6 Move `PreprocessCard` into the Guide layout and point the "no guide data" empty states at it; verify the preprocess-card tests pass and the empty state links to the action on the same tab
- [x] 2.7 Hide the Guide tab and the composer for editions that are not ready; verify with an importing edition in e2e

## 3. Discuss tab: composer and conversation list

- [x] 3.1 Build the book composer from `AutogrowTextarea`, `SendButton`, and the existing keyboard behavior, with a tab-session draft under `composer-draft:book:<editionId>` and the model choice defaulting to the chat default; verify the text survives switching to Contents and back
- [x] 3.2 Build the scope strip (unit with a training note, finished with the whole-book notice, unset asking how far) and the scope sheet (`ScopeChoices`, save vs. this-conversation-only radio, shared caveat, bottom sheet below `sm`); verify component tests for all three strip states and both sheet options, including move-back confirmation only on save
- [x] 3.3 Implement the one-off override state with "Use my position" and its discard on leaving the page; verify sending with an override creates the conversation at that scope and leaves the position unchanged
- [x] 3.4 Implement send: open the sheet first when unset (nothing preselected, save selected), then `createConversationFn`, save the draft under the new id, and navigate with history state `autoSend`; verify dismissing the sheet creates nothing and keeps the text, and a stale choice keeps the text and asks again
- [x] 3.5 In `/c/$id`, auto-submit the restored draft once when `autoSend` is set and the conversation has no messages, then clear the state; verify e2e that the first message is sent once, and that reloading right after landing does not send it again
- [x] 3.6 Render the conversation list (title, scope, count, last active, preview as text, whole row a link, `...` menu with Rename and Delete); verify e2e rename and delete from the menu and a long title truncating with the menu still visible
- [x] 3.7 Replace the composer with `AiSetupNotice` when AI is not configured or the model cannot be resolved, still showing the list; verify both states in a component test
- [x] 3.8 Make `books.$editionId_.conversations.tsx` redirect to `/books/$id` and remove its page; verify the old URL lands on Discuss

## 4. Mobile layout

- [x] 4.1 Compact app header (icon buttons with aria-labels below `sm`) and a one-line unprotected notice; verify at 360px the header is one row and the notice is one line
- [x] 4.2 Library: two-column grid at 360px, horizontally scrolling status filters, upload reachable; verify at 360px with no horizontal page scroll
- [x] 4.3 Book tab bar scrolls horizontally on narrow screens and the header, position, and composer fit above the fold on a 390x844 viewport; verify with a Playwright mobile viewport screenshot check
- [x] 4.4 Conversation view: collapse scope and model controls into a disclosure below `sm` and dock the composer with `dvh` units; verify at 360px the header is at most a quarter of the viewport and the controls are reachable
- [x] 4.5 Make dialogs and choice sheets fit the viewport and scroll internally; verify the scope sheet with a 200-unit book on a phone viewport keeps its actions reachable

## 5. Tests and cleanup

- [x] 5.1 Update e2e tests that click "Start conversation" on the book page, visit `/conversations`, or search on `/books/$id?q=`; verify `pnpm test:e2e` (or the project's e2e command) passes
- [x] 5.2 Add a Playwright project or test group at a 360px viewport that visits library, each book tab, a conversation, and settings and asserts no horizontal overflow; verify it passes
- [x] 5.3 Run lint, typecheck, and unit tests (`biome`, `tsc`, `vitest`) and verify all pass
- [x] 5.4 Run `openspec validate rework-book-page --strict` and verify it passes
