## Context

Assistant messages are rendered in `AssistantMessage` (`src/routes/c.$conversationId.tsx`), which maps each message part to either `AssistantText` or `ToolActivity` (`src/components/chat.tsx`). Tool parts follow the AI SDK UI shape: `type` is `tool-searchBooks`, `tool-readPassage`, `tool-getOutline` (or `dynamic-tool`), with `state`, `input`, `output`, and `errorText`. Tool parts are persisted with the message, so no stored data changes.

Output shapes (from `src/modules/conversation/tools.ts`):
- `searchBooks`: `{status, count, truncated, results: [{book, bookTitle, locator, section, position, text}]}`, or an `unknown_book` error object.
- `readPassage`: `{status: "ok", book, bookTitle, section, path: string[], passage, before[], after[]}`, or `{status: "not_found" | "removed" | "not_in_conversation", locator}`.
- `getOutline`: `{status, outlines: [{book, bookTitle, entries}]}`.

The reader route is `/p/$locator` with an optional `hl` range search param, already used by citations. See proposal.md for motivation. Spoiler filtering of trail content is explicitly deferred.

## Goals / Non-Goals

**Goals:**
- Replace per-call rows with one trail per run of consecutive tool parts, with readable steps and links into the book.
- Keep raw tool data available, but opt-in.
- Present the trail well while streaming and after reload without extra server work.

**Non-Goals:**
- Hiding or gating passage text because of spoilers.
- Changing tools, tool output shapes, message storage, or the chat endpoint.
- Showing tool input or output outside the trail (for example a global debug page).
- Server-side persistence of the "Show tool details" preference.

## Decisions

**1. Group in the render layer.** `AssistantMessage` walks `message.parts` and builds an array of blocks: text blocks and trail blocks, where a trail block holds a run of consecutive tool parts. A text part ends a trail. Alternative: group at storage time. Rejected because stored parts already work, existing conversations benefit immediately, and no migration is needed. Other part types the loop already ignores (such as `data-citations`) do not break a run.

**2. Pure step view-model, separate from components.** A function `describeStep(part)` returns `{kind, status, label, detail?, passages[], raw}`. `status` is one of `running`, `ok`, `empty`, `failed`, or `unavailable`. It reads outputs defensively: tool output is untrusted shape-wise (stored JSON, older or truncated payloads, `unknown_book` errors), so missing fields degrade to the generic label rather than throwing. This function is unit-testable without React, and the components stay thin. Alternative: switch on tool type inside JSX, as `describeTool` does now. Rejected for testability and because labels, counts, and passage lists all derive from the same parse.

**3. Labels from output, not input.** Read-step labels come from `output.path` (joined with " › ", falling back to `section`, then the locator), because the locator input is meaningless to readers. While a step is still running there is no output, so it shows "Reading passage…". Search labels use the input `query` and the output `count`.

**4. Passage links reuse the citation link shape.** Passage rows link to `/p/$locator` using the passage's locator from the output. Search results link without a highlight. Read steps link to the read passage. Locators are used as given; the reader route already resolves superseded locators, so no extra resolution is done in the trail.

**5. Auto-collapse as default state, not forced state.** The trail's open state is derived: open while the message has no reply text and the last step is not finished, collapsed otherwise. The reader's explicit toggle is tracked in local state and, once set, wins over the derived value. This honors "do not override the reader" without effects fighting streaming updates. Alternative: a controlled state updated in `useEffect` when text appears. Rejected as it would need to detect whether the user had interacted, which is the same state as above with more moving parts. Messages loaded from storage have text, so they render collapsed.

**6. Collapsible built on `<details>` semantics or Radix Collapsible.** Use `Collapsible` from the `radix-ui` package already installed, which allows a controlled `open`. Native `<details>` is hard to drive from derived state. Individual steps with passage lists use the same component.

**7. Raw data: per-step toggle plus a browser preference.** Each step has a small "Raw" button revealing `JSON.stringify({input, output}, null, 2)` in a `<pre>` with a copy button (`navigator.clipboard`). The "Show tool details" preference is stored in `localStorage` under one key, read through a small hook that uses `useSyncExternalStore` so it is hydration-safe and shared across messages. The preference toggle sits in the trail header area when expanded. Alternative: a settings page. Rejected as too heavy for a single boolean. Raw output is no longer clipped to 4000 characters by the UI beyond a display cap with its own "show more", since tool output is already capped server-side.

**8. Snippet truncation uses CSS line clamp with a toggle.** `line-clamp-3` with a "Show more" button, not scroll containers. The button only appears when the text is long enough, judged by character count rather than layout measurement, which keeps it SSR-safe.

**9. Styling.** Muted text, a thin left rule, small type, and no boxed rows. The summary line uses a chevron and counts. Counts come from the step view-models: searches are steps of kind `search`, passages read are steps of kind `read`.

## Risks / Trade-offs

- [Defensive parsing hides tool shape changes] → Fall back to the generic label and keep raw data available, and cover the shapes (including error statuses) in unit tests against fixtures copied from `tools.ts` outputs.
- [Derived open state flickers if a step finishes and text arrives in separate updates] → Derive from "has any reply text", not per-step state, so the collapse happens once.
- [Trail shows passage text from later in the book] → Accepted for now (spoiler-safe behavior deferred); the trail stays collapsed by default after the reply starts.
- [`localStorage` unavailable (private mode, SSR)] → The hook returns the default (off) on the server and when access throws.
- [Clipboard API unavailable] → Hide or disable the copy button without error.

## Migration Plan

Frontend only. No data migration. Rollback is reverting the change; stored messages are untouched.
