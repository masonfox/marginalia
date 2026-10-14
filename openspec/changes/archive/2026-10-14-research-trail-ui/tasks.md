## 1. Step view-model

- [x] 1.1 Create `src/lib/research-trail.ts` with `describeStep(part)` returning kind, status (`running`, `ok`, `empty`, `failed`, `unavailable`), label, passages, and raw data; verify it compiles and is exported
- [x] 1.2 Handle `searchBooks` output (query and count label, zero-result "no matches", passage list with section, book title, locator, snippet) and verify with unit tests built from fixtures matching `tools.ts` output, including `unknown_book`
- [x] 1.3 Handle `readPassage` output (label from `path` joined with " › ", falling back to `section`, then locator; `not_found`, `removed`, `not_in_conversation` as `unavailable`) and verify with unit tests
- [x] 1.4 Handle `getOutline`, unknown tools, `output-error` state, in-progress state with no output, and malformed or missing output without throwing; verify with unit tests
- [x] 1.5 Add `groupParts(parts)` that splits message parts into text blocks and trail blocks (a run of consecutive tool parts, ended by a text part, ignoring other part types) and `summarizeTrail(steps)` for "Researched · N searches · M passages read"; verify with unit tests, including pluralization and zero counts

## 2. Preference

- [x] 2.1 Add a `useToolDetails()` hook backed by `localStorage` via `useSyncExternalStore`, returning off on the server and when storage access throws; verify with a unit test using a stubbed storage, and verify no hydration warning when loading a page with the preference on

## 3. Components

- [x] 3.1 Build `ResearchTrail` in `src/components/chat.tsx` (or a new `src/components/research-trail.tsx`) using Radix `Collapsible`, with derived open state (open while no reply text and not finished, collapsed otherwise) overridden by the reader's explicit toggle; verify in the browser that it expands during research, collapses when text starts, and stays open if the reader opened it
- [x] 3.2 Build the step row: status icon, readable label, result count, and failure or unavailable text; verify each status renders as in the spec scenarios
- [x] 3.3 Build the passage list for expanded steps: snippet, section, book title when more than one book, `Link` to `/p/$locator`, and a line-clamp with "Show more" for long text and no nested scroll areas; verify clicking a result opens the passage
- [x] 3.4 Add the per-step "Raw" toggle showing formatted JSON with a copy button that degrades gracefully without the clipboard API, and a "Show tool details" switch in the trail that uses the preference hook; verify raw data is hidden by default and appears per step and globally
- [x] 3.5 Style the trail as muted secondary content (small type, thin left rule, compact one-line summary) and verify the reply starts without scrolling past tool rows on a message with seven tool calls

## 4. Integration

- [x] 4.1 Update `AssistantMessage` in `src/routes/c.$conversationId.tsx` to use `groupParts`, rendering `ResearchTrail` for trail blocks and `AssistantText` for text blocks, and pass whether any reply text exists; verify sources list and citations are unchanged
- [x] 4.2 Remove the old `ToolActivity` and `describeTool` code once nothing uses it, and verify `tsc` and Biome report no unused exports
- [x] 4.3 Run `npx tsc --noEmit` and the unit tests (`npx vitest run src/lib`), and verify they pass
- [ ] 4.4 Manually verify in the browser against a conversation with several searches and reads: streaming behavior, reload (collapsed), a failed or empty search, a multi-trail message, and the preference surviving a reload
