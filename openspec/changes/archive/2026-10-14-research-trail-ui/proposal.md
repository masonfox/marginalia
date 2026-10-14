## Why

When the assistant researches a question, the chat shows one collapsed row per tool call ("Searched for “Shrike”", "Read passage a56e39d8dcd8:v1:25.145"), and expanding a row dumps raw JSON. A single answer can produce seven or more stacked rows that push the reply down the page. The rows use opaque locators, hide whether a search found anything, and cannot be followed to the passage. The research is useful to a reader, since it shows what the answer rests on. It is currently presented as a debugging view.

## What Changes

- Group consecutive tool calls in an assistant message into one **research trail** block. While the model works, the block is expanded and shows the step in progress. Once reply text starts streaming it collapses to a one-line summary such as "Researched · 4 searches · 3 passages read".
- Render each step in readable form instead of raw tool names and locators:
  - Search steps show the query and the result count, and zero results are shown as "no matches".
  - Read steps show the book section path (for example "Part Three › Chapter 23") instead of the locator.
  - Outline steps show "Browsed the table of contents".
  - Failed steps show the error inline.
- Expanding a search or read step lists the passages involved, each as a snippet that links to the passage in the reader, with long text truncated behind "show more" instead of nested scroll boxes.
- Raw tool JSON is hidden by default. Each step offers a "Raw" toggle that shows formatted JSON with a copy button, and a "Show tool details" preference, persisted in the browser, shows raw JSON for every step.
- Restyle the trail as muted secondary content so the reply stays the focus.
- No spoiler filtering of trail contents in this change.

## Capabilities

### New Capabilities
- `research-trail`: how an assistant message presents its tool activity to the reader, including grouping, step summaries, links to passages, and access to raw tool output.

### Modified Capabilities
<!-- None. The existing requirement that tool calls and results are stored and visible is unchanged; this change defines how they are presented. -->

## Impact

- `src/components/chat.tsx`: replace the per-call `ToolActivity` row with a trail component and step renderers.
- `src/routes/c.$conversationId.tsx`: `AssistantMessage` groups consecutive tool parts and tracks whether reply text has started.
- Read tool output shapes from `src/modules/conversation/tools.ts` only; no server, schema, or API changes. Tool parts are already stored with messages, so existing conversations get the new presentation.
- A new browser-local preference (`localStorage`). No new dependencies.
