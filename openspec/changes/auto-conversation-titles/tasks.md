## 1. Durable eligibility and first-message persistence

- [ ] 1.1 Add naming state, captured model/opening-message reference, attempt id and deadline columns/checks/indexes; generate the Drizzle migration and verify against a populated database that all preexisting conversations, including empty ones, remain ineligible while updated creation explicitly enrolls new rows.
- [ ] 1.2 Integrate provisional naming and pending enrollment into the first user-message append transaction using the existing row lock; verify rollback leaves neither an orphan message nor pending state, and concurrent first-message requests enroll only once with the first turn's resolved model.
- [ ] 1.3 Keep retries and subsequent messages outside enrollment and preserve provisional whitespace/60-character behavior; verify tests cover reply retries, model/default changes, old conversations and manually locked conversations.

## 2. Durable bounded execution

- [ ] 2.1 Add conversation.title job kind, handler wiring and TITLE_CONCURRENCY configuration default 2 with deployment documentation; verify payload validation, singleton keys, worker-disabled enqueue behavior, configuration validation and per-process concurrency tests.
- [ ] 2.2 Add caught post-commit enqueue plus startup/recurring pending dispatcher (one-minute schedule, batches of 100, five-minute pending expiry); verify enqueue failure and crash between commit and send recover without delaying/failing chat, duplicate dispatch is safe, and absent workers expire work without AI calls.
- [ ] 2.3 Implement atomic pending-to-running attempt claim, 30-second deadline and recovery of expired running states; verify competing workers and pg-boss redelivery after crashes invoke the provider at most once, including crash immediately before invocation and after receiving a result.
- [ ] 2.4 Add the versioned title prompt and bounded single-call generator (8,000 code-point input, 256 output tokens, maxRetries=0, no tools, worker signal plus timeout); verify captured selection/provider options are used, attachments and replies are excluded, SDK retries are disabled, and missing credentials never trigger model fallback.
- [ ] 2.5 Add title normalization/validation and terminal failure paths; verify empty, multiline, oversized, truncated and explanatory outputs preserve provisional titles without a corrective call. Review representative opening questions for recognizable roughly 3-7-word subject titles, no added interpretation/spoilers, and multilingual behavior.

## 3. Races, cancellation and deletion

- [ ] 3.1 Add conditional title persistence and terminal transitions guarded by attempt/state/deadline/titleLocked without updating activity time; verify database integration tests cover rename-before-write, write-before-rename, rename to provisional/default string, stale result and unchanged keyset ordering.
- [ ] 3.2 Terminalize naming during manual rename and best-effort cancel jobs after commit; verify final title remains manual despite failed cancellation or a late worker result, and reported usage is still retained.
- [ ] 3.3 Handle explicit deletion and last-book pruning in queued/running work; verify deletion before claim, during provider execution and during usage persistence cannot recreate rows or surface chat errors, while removing one of multiple books does not restart naming.
- [ ] 3.4 Isolate reply cancellation from naming and honor worker cancellation/shutdown; verify stop, disconnect and reply error leave naming independent, worker abort becomes terminal, and expired late results cannot write titles.

## 4. Usage accounting

- [ ] 4.1 Extend usage schema/types with conversation-title and attempt-id uniqueness; verify duplicate finalization records one row with conversation linkage, actual producer and null message/edition ids, and inspect generated migration SQL for the existing text-purpose representation.
- [ ] 4.2 Persist provider usage and terminal outcome transactionally with parent existence/lock checks, retaining reported counts on failure or manual supersession; verify unknown counts, incomplete calls, local persistence retry without provider reinvocation, crash-lost accounting indication and deletion races.
- [ ] 4.3 Filter reply attribution/missing counts to conversation purpose, retain combined model totals and expose naming contribution plus unknown/incomplete indicators; verify sums include naming and failed reply attempts once, per-reply figures and missing-reply counts are unchanged, unknown prices suppress total estimates, and edition totals exclude naming.

## 5. Completion visibility

- [ ] 5.1 Extend detail/list DTOs and add protected bounded batch naming metadata reads; verify authentication, maximum 100 ids per request, pending/deadline metadata, terminal usage summary and deleted-id handling.
- [ ] 5.2 Add shared visible-pending polling at one-second intervals with mount/focus/reconnect reconciliation and deadline cleanup; verify fake-timer tests cover slow naming after reply finish, transient network failures, hidden tabs, terminal states, deletion and unmount without endless polling.
- [ ] 5.3 Integrate header, dashboard, global paginated list and book Discuss list metadata patches; verify component tests preserve streamed messages, typed drafts, loaded pages/cursors and activity order, and discard stale polling responses racing with successful manual rename.
- [ ] 5.4 Display naming contribution and incomplete/unknown accounting in conversation usage details and refresh totals on completion; verify title completion before and after reply usage persistence yields correct independent updates.

## 6. Integrated verification and rollout

- [ ] 6.1 Add browser coverage using controlled provider timing for reply-first/title-first completion, manual rename races, stopped replies, mounted lists and navigation/reload; verify generated titles appear without a new message and provisional fallback remains usable on naming failure.
- [ ] 6.2 Exercise separate web/worker processes, restart boundaries, queue saturation and pending expiry with PostgreSQL integration tests; verify bounded concurrency, durable dispatch recovery, no historical enrollment and no repeated provider calls.
- [ ] 6.3 Run relevant unit/integration/browser suites plus pnpm typecheck and pnpm lint, then validate the OpenSpec change; record results and verify schema-first deployment and additive rollback documentation preserve titles and usage.
