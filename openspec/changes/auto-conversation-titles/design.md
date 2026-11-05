## Context

See proposal.md for motivation. In src/modules/conversation/chat.ts, prepareHistory persists the opening message then calls setProvisionalTitle. repository.ts collapses whitespace and truncates to 60 characters only when the title remains DEFAULT_TITLE and titleLocked=false; renameConversation sets titleLocked=true. appendMessage already locks the conversation row to serialize sequence allocation and bumps updatedAt. The reply stream onEnd separately saves the assistant and records conversation usage. Naming must not be attached to that callback.

The conversation route c.$conversationId.tsx invalidates on finish and polls up to five times at 600ms for reply usage; this cannot cover independent late naming. Lists include dashboard, global conversations and per-book Discuss surfaces, with keyset activity ordering. usage/conversation.ts totals all conversation-linked rows by model, but byMessage includes any message-linked row, and missing counts assistant replies. usage/schema.ts and record.ts only accept conversation/preprocess purposes.

server/jobs/runtime.ts already provides pg-boss persistence, exclusive singleton keys, per-kind local concurrency, retries, cancellation signals and graceful shutdown. It enqueues through a separate connection, not the message transaction. Jobs can run in a dedicated worker; web-only processes still enqueue. No new queue service is needed.

## Goals / Non-Goals

**Goals:** Isolate naming from reply latency/failure; make eligibility, provider-attempt consumption and title precedence atomic; bound cost and execution; make terminal state and accounting observable without disrupting live chat.

**Non-Goals:** Exactly-once delivery to an external provider after a crash, guaranteed successful naming, answer-derived titles, attachment analysis, later retitling, historical naming, a dedicated title model, or a general push-event platform.

## Decisions

### 1. Durable state doubles as an outbox

Add conversation naming state: ineligible, eligible, pending, running, succeeded, failed, skipped; opening message id, captured provider/model, pending expiry, started deadline and a stable attempt id. Existing rows migrate to ineligible, including empty rows. New inserts explicitly become eligible; retain an ineligible database default so old application instances cannot accidentally enroll conversations. No title-text heuristic decides eligibility.

Refactor the first-message append transaction to set the provisional title with its existing predicate, snapshot the resolved first-turn selection, and move eligible to pending alongside storing that message. Only the first persisted user message can do this. If already manually locked, mark skipped without requesting naming. The row lock and state predicate protect concurrent requests across processes even though the current reply inFlight guard is process-local. Retry preparation never enrolls work.

After commit, best-effort enqueue conversation.title keyed by conversation id. Catch/log enqueue failures without changing chat success. A recurring dispatcher (every minute, at most 100 rows per batch) republishes pending rows and expires overdue pending/running states; startup dispatch uses the same path on workers. This closes the message-commit/queue-send crash gap without requiring a transactional pg-boss adapter. Payloads contain ids only; the database owns the captured model and prompt reference. Pending expires five minutes after the first message so disabled or absent workers cannot produce unexpectedly late titles. Repeated dispatch is safe under queue deduplication plus the durable claim. Dispatcher failures use existing backoff and remain recoverable.

Alternative: request-scoped fire-and-forget is simpler but loses work on exit and lacks bounds. Direct enqueue alone loses the commit/send gap. Reusing titleLocked as completion state conflates user intent with automation.

### 2. Queue redelivery must never repeat a provider attempt

Use the existing job runtime with a new conversation.title kind, singleton key conversation id, configurable per-process TITLE_CONCURRENCY default 2, and existing bounded infrastructure retry policy for pre-claim database failures. This is a per-process limit, consistent with existing job kinds; deployments with multiple workers multiply it.

The handler atomically claims pending to running with a fresh stable attempt id and a 30-second deadline, checking expiry, opening message, model and titleLocked. Commit this transition before invoking the provider. Only the successful claimant may call AI. SDK maxRetries=0, no tools and one generation call. Combine the worker signal with a 30-second timeout. Set maxOutputTokens=256 including reasoning; preserve selected-model provider options and runtime reasoning compatibility. Read at most 8,000 Unicode code points of the opening text with a truncation indication. Do not include book maps, passage snapshots, quoted assistant context, later messages or retrieval tools.

A redelivered running/terminal job never calls AI again. Recovery marks running states past deadline failed; late results must match attempt id, running state and an unexpired deadline. Provider errors, cancellation, timeout and validation failure are terminal, not naming retries. Pre-provider model unavailability is terminal too, with no fallback to another model. Jobs that lose their row or find a locked title exit harmlessly. Stop/disconnect of the reply does not feed the naming signal; worker shutdown/cancellation does.

An interrupted post-claim attempt can lose its result or usage; this is an intentional at-most-once provider invocation policy. Retrying a queue delivery rechecks durable state rather than violating the opening-only contract. The existing background-jobs retry/restart behavior remains unchanged for other kinds.

### 3. A narrow title prompt and conservative validation

Use a versioned title-only system prompt: roughly 3-7 words, recognizable subject, no answer, interpretation, spoilers, explanation or formatting. Treat the opening question as untrusted user content and never as system instructions. Accept a nonempty single-line plain-text title after trimming, whitespace normalization and removal of enclosing quotation marks. Reject multiline responses, obvious explanations, more than 100 Unicode code points, or truncated/unsuccessful output. Word count is a prompt target, not a rigid multilingual validator. Do not make a corrective AI call or truncate an answer into a title. Render escaped text through existing title components.

Alternative: deriving from assistant output risks spoilers and couples completion timing. A rigid word-count filter rejects otherwise recognizable titles in languages without spaces. A short output cap can fail on reasoning-heavy models; preserving fallback is preferable to increasing spend or silently changing models.

### 4. Atomic manual precedence and deletion safety

Persist an automatic title only via conditional update on conversation id, attempt id, running state, deadline and titleLocked=false. Do not require title=DEFAULT_TITLE because the provisional title has already replaced it. Do not bump updatedAt: naming is metadata, not message activity, so list cursors and relative activity remain stable.

Manual rename keeps setting titleLocked=true and terminalizes pending/running naming as skipped in the same transaction. If generation writes first, the later rename overwrites it; if rename writes first, the generation predicate fails. Renaming to the same string still locks. Best-effort cancel queued/running jobs after rename, but correctness never relies on queue cancellation. Generated success uses its own terminal state rather than setting titleLocked.

Explicit deletion and pruning after the last book disappears cascade state and usage. Cancel known jobs best-effort; queued handlers check existence, running completions lock/recheck the parent before any writes and silently discard deleted-parent results. Never recreate rows. Removing one of several books does not restart naming or change the opening-text input.

### 5. Independent bounded refresh on every mounted title surface

Expose naming state and expiry/deadline in conversation detail and summary DTOs; use a shared client hook for the header, dashboard, global paginated list and book Discuss list. While visible rows contain pending/running work, request a protected lightweight batch status endpoint every second (batch at most 100 ids, chunk larger loaded lists). Also query on mount, window focus and reconnect. Status returns persisted title, lock/state, naming accounting summary and completion revision; 404/missing ids stop tracking and trigger deletion reconciliation. Pending lifetime/deadline bound tracking; after the bound perform a final fetch and cease periodic polling. Hidden tabs pause polling and reconcile on focus.

Patch only matching title/status/usage metadata into loaded list pages, preserving cursors, loaded pages, draft and useChat state. Patch the header from persisted metadata without reseeding live messages. Ignore stale responses using request generations; a successful manual rename cancels older metadata requests before applying its response, then revalidates. Server lock precedence alone is insufficient if an older browser response could repaint it. Refresh title usage totals when terminal state arrives. Existing reply usage polling remains independent. Network failures keep displayed titles and retry only within the tracking window.

Alternative: finish invalidation misses late titles; stream events do not reach lists or disconnected clients; introducing SSE is unnecessary for bounded, one-time metadata updates.

### 6. Account for naming without inventing an assistant message

Add conversation-title to usage schema/type purposes. Naming rows have conversationId, captured provider/model, messageId=null and editionId=null, plus stable attempt id with a partial unique index for naming idempotency. Preserve token unknowns and steps using existing helpers. Record reported usage even for invalid titles and results discarded after manual rename. complete describes provider-call completion, not whether the title was accepted; timeout/error/cancellation mark incomplete. Retain available usage from provider failures; never fabricate unavailable counts.

Persist usage, generated-title conditional update and terminal state in one transaction under the parent row lock. If a rename has already terminalized naming, still allow idempotent usage insert for the original attempt without changing its title/state. If persistence fails, retry only the local database write within the deadline using the captured result, never the provider call. Expired/stale results may still contribute idempotent usage, but cannot change the title. On process loss, expose failed/interrupted naming with unknown/incomplete accounting rather than pretending zero spend. Do not roll back chat or surface a naming error to the reader; sanitized operational logs cover missing accounting.

Existing all-rows byModel totals naturally include title rows; explicitly constrain byMessage and assistant missing-usage joins to purpose=conversation. Add a separate naming usage summary and missing/incomplete naming indicator, leaving the existing missing-replies count unchanged. Show naming's contribution in conversation usage details and include it in the header total with existing price/unknown-price conventions. Deletion cascades usage and suppresses parent-missing inserts. Edition preprocessing totals remain purpose-filtered.

## Risks / Trade-offs

- Crash after durable claim but before provider invocation or result persistence -> retain provisional title and expose unknown accounting; do not retry a potentially billable call.
- External provider ignores abort -> deadline/state predicates reject late writes; SDK cancellation and output/time limits bound normal operation, but cannot guarantee remote billing cancellation.
- Worker disabled or saturated -> pending expiry preserves fallback and bounds client polling; document that naming needs a worker and its concurrency is per process.
- Short opening text or prompt injection -> title-only instructions, narrow inputs and plain-text validation; semantic quality is verified with representative fixtures, not guaranteed by syntax validation.
- Polling cost -> visible pending rows only, bounded batches/lifetimes, focus reconciliation and shared hooks.
- Mixed deployment versions -> ineligible database default avoids accidental enrollment; deploy schema before updated application/worker, without running historical scans.

## Migration Plan

1. Add naming columns/checks/indexes and idempotency column/index on usage through the normal Drizzle migration workflow; update usage purpose types (currently text with a TypeScript enum, so inspect generated SQL rather than assuming a PostgreSQL enum migration).
2. Existing conversations stay ineligible. Updated creation explicitly enrolls new conversations. Deploy worker kind/dispatcher and web integration together after migration; register dispatcher after app context is available, respecting worker-only scheduling.
3. Verify queued work recovers across process restart, bounded expiry and at-most-once invocation, then check header/list refresh and accounting in a real browser.
4. Rollback application/worker code first and stop the title dispatcher/queue consumers. Preserve additive columns and recorded usage; do not delete title usage or reverse user titles. A schema rollback is optional only after quiescing jobs and preserving accounting data.
