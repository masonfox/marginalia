## Why

Conversations are strictly linear, so following up on one idea in a reply pushes everything else down the history and pulls the whole discussion off course (issue #20). Readers need to dig into a specific passage of a response in a side discussion and then return to the main conversation without the tangent filling it.

## What Changes

- Add side threads anchored to text selected in an assistant response in the main conversation. The selection toolbar gains a **Thread** action next to the existing **Reply** and **Note**.
- Open threads in a side panel beside the conversation on wide screens, and in a full-screen drawer on small screens. The panel shows the anchor quote, the thread's messages, and its own composer.
- Mark anchors in the main conversation with an underline on the threaded text and a thread-count chip under the response. Either one opens the thread.
- Create a thread only when its first message is sent. Opening the panel stores nothing.
- Allow threads to start only from assistant responses in the main conversation, never from reader messages, book text, or messages inside a thread. Threads are one level deep.
- In a thread, the model sees the main conversation up to and including the anchored response, the anchor quote, and the thread's own messages. The main conversation never receives thread messages.
- In a thread panel, the selection toolbar offers **Reply** (quote into the thread composer) and **Bring to main** (quote into the main composer). This reuses the existing assistant-response quote, and it is the only way thread content reaches the main conversation.
- Run one generation at a time per conversation, across the main conversation and all its threads.
- Have threads inherit the conversation's model. Thread activity counts as conversation activity. List previews keep showing main-conversation messages only.
- Include thread usage in the conversation total, and show a thread's own total in its panel.
- Key composer drafts and pending quotes by conversation and thread.

## Capabilities

### New Capabilities

- `conversation-threads`: Starting, storing, displaying, and conversing in side threads anchored to assistant-response text, including model context, isolation from the main conversation, carrying text back, retries, and per-thread usage.

### Modified Capabilities

- `literary-conversations`: Covers streaming concurrency across threads, Reply to selection inside threads, how pending and persisted quotes are scoped to the main conversation or a thread (including Bring to main sources), per-thread draft restoration, root-only list previews with thread activity counted, and usage totals that include threads.
- `responsive-layout`: Adds the full-screen thread drawer on small screens.

## Impact

Conversation schema and migration (a threads table, plus a nullable thread reference on messages); chat preparation, history assembly, retry, and quote validation in `src/modules/conversation`; the chat HTTP body (thread ID or new-thread anchor); the conversation repository and list preview query; usage aggregation; the conversation route, selection toolbar, composer drafts, and a new thread panel/drawer UI. No new dependencies. Existing conversations are unchanged and have no threads.
