## Context

See proposal.md for motivation. The pieces threads build on already exist:

- `messages` rows are ordered by a gap-free `seq` per conversation. `appendMessage` (`src/modules/conversation/repository.ts`) locks the conversation row to allocate `seq` and bumps `conversations.updatedAt`.
- `prepareHistory` (`src/modules/conversation/chat.ts`) appends the user message, or prepares a retry by removing a trailing errored assistant message, then replays stored history. A process-local `inFlight` set gives one generation per conversation.
- Reply to selection already captures selected response text (`src/components/reply-selection.tsx`), stores it as a versioned `data-reply-context` part, and projects it into labelled model text (`src/lib/reply-context.ts`).
- The selection toolbar already offers Reply and Save as note. Composer drafts live in `sessionStorage` under per-surface keys (`src/lib/composer-draft.ts`).
- Usage rows (`ai_usage`) link to both the conversation and the message, so conversation totals already include any message in the conversation.
- The conversation route `c.$conversationId.tsx` drives one `useChat` instance and validates its search params with zod.

## Goals / Non-Goals

**Goals:** Side threads that reuse the existing stored-history, quote, and prompt-prefix machinery; thread turns that share the main conversation's cached prompt prefix; no change to how existing conversations replay.

**Non-Goals:** Branching on edit or regenerate; nested threads; threads anchored to reader messages or book text; renaming, deleting, or resolving individual threads; per-thread models or scopes; automatic summaries of a thread fed back to the main conversation; running the main conversation and a thread at the same time.

## Decisions

### 1. A `conversation_threads` table plus a nullable `messages.thread_id`

```
conversation_threads
  id                uuid pk
  conversation_id   uuid -> conversations (cascade)
  anchor_message_id uuid -> messages (cascade)   -- a main-conversation assistant message
  anchor_quote      text  (1..2000 after trim)
  created_at, updated_at

messages
  + thread_id uuid null -> conversation_threads (cascade)   -- null = main conversation
  + index (conversation_id, thread_id, seq)
```

`seq` stays one gap-free sequence per conversation, shared by the main conversation and its threads. `appendMessage` already serializes on the conversation row, so nothing about allocation changes, and `seq` still gives a total order for activity. A thread's history is "main messages with `seq <= anchor.seq`" followed by "messages with `thread_id = T`", ordered by `seq`.

Alternatives considered:
- A `parent_message_id` tree. It is more general, but it models edit-and-regenerate branching, which is a non-goal. It would also force every history query into a recursive walk.
- A child conversation per thread. That duplicates books, scope, model, and naming state. Scope or model changes would then have to propagate, and the conversation lists would need filtering.

The anchor quote lives on the thread row rather than in the first message's parts, because it describes the thread rather than any one message, and the panel header and markers read it without loading messages.

### 2. Thread created with its first message, in one transaction

The chat body gains either `threadId` (an existing thread) or `newThread: { anchorMessageId, quote }`, never both, and neither for the main conversation. For `newThread`, inside the append transaction: validate the anchor (same conversation, assistant, `thread_id is null`, not in flight) and the quote using `replyContextSchema` rules, insert the thread, then append the user message with `thread_id`. Any failure rolls back both. This keeps "nothing is stored until the first send" without an orphan-thread cleanup job. The response stream reports the new thread ID so the client can switch the address from `?thread=new` to `?thread=<id>`.

A retry (no message) needs `threadId`. It is meaningless with `newThread`, which is rejected.

### 3. Model input: main prefix, labelled anchor, thread tail

```
[system + tools]                       identical to the main conversation
[book map reference message]           as today
main messages seq 1..anchor.seq        replayed unchanged
thread message 1 (user)                anchor quote projected in front, labelled as
                                        user-selected assistant-response context
thread messages 2..n                   replayed unchanged
```

The anchor quote is projected into the first thread user message with the same labelled-block approach as `projectReplyContext`. It uses its own wording ("Side thread about this excerpt from an earlier assistant response; not verified book evidence"), so the model knows it is in a focused digression. A first thread message that also carries a passage reference gets both projections in a fixed order. Because the main slice is byte-identical to what the main conversation sent when the anchor was the latest reply, provider prompt caching can reuse it. Thread turns after the first replay their own earlier turns unchanged, which satisfies "Stable request prefix" within the thread.

Main-conversation history assembly adds `thread_id is null`. That filter is the whole of "main conversation isolated from threads".

### 4. Concurrency key stays the conversation

`inFlight` keeps keying on the conversation ID. That gives the specified one generation across the main conversation and its threads, with no new locking. The client derives "busy" from whichever chat surface is streaming and disables both send controls.

### 5. Retry and quote validation become branch-aware

The retry path looks for the trailing errored assistant message within the same branch: `thread_id is null` for the main conversation, `thread_id = T` for a thread. Quote validation adds the branch rule: a thread message's quote source must have `thread_id = T`. A main message's quote source may be any assistant message in the conversation. A Bring to main quote stores the same `data-reply-context` part. The UI looks up the source message's `thread_id` to label it "from a thread" and link to it, so no new part version is needed.

### 6. Two chat surfaces in one route

The route search schema gains `thread?: uuid | "new"`. The main conversation keeps its `useChat` instance. The panel mounts a second `useChat` keyed by thread ID, so switching threads resets its state cleanly. The new-thread state reads its anchor from the new-thread draft. The loader returns thread summaries (ID, anchor message, quote excerpt, last activity) with the conversation. Thread messages load when the panel opens.

The panel uses a side layout at the existing wide breakpoint and the app's drawer primitive below it. The same component is rendered in both, so draft and chat state survive a breakpoint change. On small screens, opening the drawer pushes a history entry, so Back closes it.

### 7. Selection toolbar receives actions by context

`ReplySelection` already takes optional `onAttach` and `onSaveAsNote`. Add optional `onThread` and `onBringToMain`. The main conversation passes Reply, Thread, and Note. The panel passes Reply, Bring to main, and Note. Leaving `onThread` out of the panel enforces one level of nesting in the UI, and the server's anchor check enforces it on the server. Each surface scopes selection capture to its own container, so a selection crossing the panel boundary is ineligible.

### 8. Anchor markers

Markers are computed client-side from thread summaries. The chip is always shown. The underline is applied by locating the anchor quote in the rendered response text, using the same citation-pill-skipping walk that `selectedText` uses, and wrapping the first match. When it is not found, for example because of markdown rendering differences, only the chip appears. Nothing is stored about positions, so markers degrade gracefully.

### 9. Lists, drafts, usage

- **List preview:** the `latest_text` subquery adds `thread_id is null`. `updatedAt` keeps being bumped by every append, so thread activity orders and dates the row.
- **Drafts:** add keys `conversation:<id>:thread:<threadId>` and `conversation:<id>:thread:new`. The new-thread draft also stores `{ anchorMessageId, quote }`. The format version is bumped only for the new-thread shape. Existing main-conversation keys are untouched.
- **Usage:** the conversation total needs no change. The per-thread total sums `ai_usage` joined to `messages` where `thread_id = T`, and is returned with the thread's messages.

## Risks / Trade-offs

- [A long main conversation makes every thread turn carry a large prefix] → Prompt caching covers the shared prefix. Threads are bounded by the same history that main turns already send.
- [The anchor underline fails to match rendered text] → The chip always works, and the underline is cosmetic.
- [The process-local `inFlight` is not cluster-wide] → This is unchanged from today's single-process assumption, and threads don't make it worse.
- [Two `useChat` instances in one route can drift, for example over the usage total] → The route invalidates conversation-level data when either stream finishes, as it does today for the single stream.
- [Deleting a book prunes conversations] → Threads cascade with the conversation. Anchor messages are never deleted on their own, except for an errored assistant message removed on retry. That message can't be an anchor because only persisted, non-error responses are offered. The server anchor check rejects `finish_reason = 'error'` to make this explicit.

## Migration Plan

1. A Drizzle migration adds `conversation_threads`, `messages.thread_id` (nullable, no backfill), and the index. Existing rows read as main-conversation messages, so behavior is unchanged.
2. Deploy the server and client together. An older client never sends `threadId` or `newThread`, so it keeps working against the new server.
3. Rollback: drop the column and table after deleting thread messages. Main-conversation history is unaffected.
