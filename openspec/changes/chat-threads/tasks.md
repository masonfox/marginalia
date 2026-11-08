## 1. Schema and repository

- [ ] 1.1 Add the `conversation_threads` table, nullable `messages.thread_id`, and the `(conversation_id, thread_id, seq)` index with a Drizzle migration. Verify that the migration applies to a database with existing conversations and that their messages read with `thread_id` null.
- [ ] 1.2 Add repository functions to create a thread with its first message in one transaction, list thread summaries for a conversation, and load a thread's messages. Verify with integration tests that cover creation, rollback on an invalid anchor, and cascade on conversation delete.
- [ ] 1.3 Restrict the list-preview `latest_text` subquery to main-conversation messages, while thread appends keep bumping `updatedAt`. Verify with an integration test where the latest message is in a thread.

## 2. Chat server

- [ ] 2.1 Extend the chat HTTP body with `threadId` or `newThread { anchorMessageId, quote }`, mutually exclusive, with retry allowed only with `threadId`. Verify that HTTP integration tests reject malformed and conflicting bodies with 400.
- [ ] 2.2 Validate anchors server-side: same conversation, assistant, main conversation, not in flight, not errored, and quote length 1-2000. Verify that each rejection appends no message, creates no thread, and makes no provider call.
- [ ] 2.3 Assemble thread history: main messages up to the anchor's `seq`, the anchor quote projected into the first thread user message, then the thread's messages. Filter main-conversation history to `thread_id is null`. Verify with prefix tests that the system prompt, tools, and main slice are byte-identical between a main turn and a thread turn, and that main turns contain no thread content.
- [ ] 2.4 Make retry branch-aware. Verify that a failed thread reply retries once in the thread without a second user message and without touching the main conversation, and the reverse.
- [ ] 2.5 Make quote validation branch-aware: a thread message quote must come from the same thread, and a main quote may come from any thread. Verify with integration tests covering Bring to main and a cross-thread rejection.
- [ ] 2.6 Return the new thread ID in the stream response, and keep the per-conversation `inFlight` guard covering threads. Verify that a test sending to the main conversation while a thread generates gets `busy`.
- [ ] 2.7 Return the per-thread usage total with thread messages. Verify that a usage test shows the thread total and the conversation total both include a thread reply.

## 3. Selection and drafts

- [ ] 3.1 Add the `onThread` and `onBringToMain` actions to `ReplySelection`, with capture scoped to each surface's container. Verify with component tests that the main conversation shows Reply/Thread/Note, a thread shows Reply/Bring to main/Note, and a cross-boundary selection is ineligible.
- [ ] 3.2 Add composer draft keys for existing threads and the single new-thread draft, including its anchor. Verify with unit tests for save, restore, the missing-anchor discard, and quote source validity per composer.

## 4. Thread panel UI

- [ ] 4.1 Add `thread` (uuid or `new`) to the conversation route search schema, and load thread summaries with the conversation. Verify that reload restores the open thread and an unknown thread ID opens no panel.
- [ ] 4.2 Build the thread panel: anchor quote with jump-to-anchor, messages with trail, citations, and usage, a composer on its own `useChat` keyed by thread, a close control, and Escape handling. Verify with e2e that starting a thread, sending, and reopening it after reload work.
- [ ] 4.3 Switch `?thread=new` to the created thread ID after the first send, and refresh markers without a reload. Verify with e2e that the chip and underline appear immediately.
- [ ] 4.4 Disable both send controls while either surface is generating, with an in-progress notice. Verify with e2e that the main draft is kept and Send is unavailable during a thread reply.
- [ ] 4.5 Implement Bring to main: attach to the main composer, focus it, keep the panel open on wide screens, and close the drawer on small screens. Verify with e2e that the sent main message shows the "from a thread" quote label with a link that opens the thread.

## 5. Markers

- [ ] 5.1 Render thread chips under anchor responses, with a single-thread open action and a multi-thread list. Verify with a component test covering one and several threads.
- [ ] 5.2 Underline anchor text by matching the quote against rendered text while skipping citation pills, falling back to the chip only. Verify that a component test passes for both the matched and unmatched cases, and that selection and copy still work.

## 6. Responsive

- [ ] 6.1 Render the panel as a full-screen drawer below the wide breakpoint, with a back control. Browser Back should close it and restore scroll, and the composer should stay above the keyboard. Verify with a Playwright mobile-viewport e2e at 360px.
- [ ] 6.2 Keep thread state across breakpoint changes. Verify with e2e that resizing with a typed thread draft keeps the draft.

## 7. Wrap-up

- [ ] 7.1 Run `pnpm` lint, typecheck, unit, integration, and e2e suites, and `openspec validate chat-threads --strict`, and verify that all pass.
