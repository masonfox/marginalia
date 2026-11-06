# Auto-conversation-titles implementation verification

Implemented all 22 tasks in the spec-driven change. No requirements were deferred, no historical rows were enrolled, and no commits, pushes, archives or deployments were performed.

## Final checks

| Command | Result |
| --- | --- |
| pnpm test:unit | PASS: 72 files, 737 tests; final run 28.12 seconds. |
| pnpm test:integration | PASS: 37 files, 477 tests passed and 1 existing platform skip; final run 58.00 seconds. |
| pnpm test:integration src/modules/conversation/title.int.test.ts src/modules/conversation/title-process.int.test.ts src/modules/conversation/title-metadata.int.test.ts src/modules/conversation/service.int.test.ts | PASS: 4 files, 48 tests after the database-clock/lock-wait fix. |
| pnpm exec playwright test --config playwright.titles.config.ts | PASS: all 10 Chromium tests, 37.4 seconds, against a production build with isolated PostgreSQL and separate web/worker processes. |
| pnpm typecheck | PASS, exit 0. Existing route-generator warnings about test files and its circular dependency remain informational. |
| pnpm lint | PASS, exit 0: 342 files, no fixes, warnings or errors. |
| pnpm build | PASS, exit 0. Existing dependency module-directive warnings are informational. |
| openspec validate auto-conversation-titles --strict | PASS: change valid. |
| git diff --check | PASS; no staged content changes. |

The single skipped integration case is the existing Windows exclusion for ?follows symlinks only within the root? in src/modules/library/library.int.test.ts. No naming tests were skipped, and no failed checks remain unresolved. Windows checkout CRLF bytes were normalized to the repository formatter's LF convention; unchanged files retain their original Git blobs and introduce no content diff.

## Contract evidence

- Durable eligibility and enrollment: title.int.test.ts migrates a populated pre-change database, including an empty conversation, and verifies the ineligible default for old-version inserts. New creation explicitly writes eligible. Concurrent first messages retain the winning message/model; a triggered transaction failure rolls back both message and pending state. service.int.test.ts covers retry and default/model changes, plus enqueue failure without reply failure or later-turn enqueue.
- Bounded execution: title-process.int.test.ts exercises real pg-boss with a separate child worker and a web-only producer, startup dispatch recovery, exclusive singleton keys, default concurrency two, saturation, pending expiry and batches of 100. Crashes immediately after claim and immediately after receiving a provider response are redelivered through pg-boss without another call. title.int.test.ts verifies a provider ignoring abort still releases the slot at 30 seconds. Claim expiry is rechecked after acquiring the parent row lock using PostgreSQL clock_timestamp(), including a test where expiry passes while the lock is held.
- Narrow provider call: title.test.ts and title.int.test.ts verify the versioned prompt, 8,000 Unicode code-point input including truncation marker, 256 output tokens, captured selection/provider options, no tools, no SDK retry for retryable errors, no fallback when credentials disappear, and exclusion of attachments and later turns. Invalid, multiline, oversized, explanatory and unsuccessful/truncated output preserves the provisional title without correction calls.
- Manual/deletion/cancellation safety: database tests cover both rename/write orders, manual names equal to default or provisional titles, failed queue cancellation, stale attempts, late results, unchanged activity/cursor order, deletion before claim/during generation/during accounting, and last-book pruning versus removal of one of multiple books. Browser tests cover stopping and disconnecting from a streaming reply while naming continues. Worker abort is terminal; expired output cannot replace titles.
- Separate accounting: naming rows have conversation-title purpose, stable unique attempt id, captured producer, null message/edition ids, preserved nullable token categories, steps and completeness. Finalization holds the parent lock, inserts idempotently and writes eligible titles atomically; local DB persistence retries never repeat AI. Failed calls and manual supersession retain reported usage; crash-lost accounting is shown as unknown/incomplete. Accounting-only finalization advances metadata revision without changing activity. title-metadata.int.test.ts verifies combined sums, failed reply attempts, unchanged per-reply figures/missing counts, unknown prices, edition exclusion and deletion races.
- Completion visibility: the protected metadata endpoint validates at most 100 UUIDs and uses a fixed query count without loading message histories. Shared visible-tab polling chunks larger lists, reconciles mount/focus/reconnect, bounds network requests and final deadline fetches, stops terminal/deleted/unmounted work and rejects stale rename responses. Hook/component tests preserve drafts, simulated live reply state, newer reply totals, loaded pages, cursors and order, and reconcile deletion. Browser tests verify reply-first/title-first usage updates, header/dashboard/global/book lists, authentication, navigation/reload and usable failure fallback without another message.

## Prompt quality fixture review

Reviewed recognizable subject-only examples for river imagery, contrasting narrators, a Spanish garden question, a Japanese question about leaving home, and an instruction-injection request about the ending. The reviewed targets remain subjects rather than answers or interpretations, do not add spoilers, and preserve language; the prompt aims at roughly three to seven words without imposing a word-count rejection on languages without spaces. These are controlled fixtures, not a claim of guaranteed semantic quality from every external model.

## Migration and rollout review

Generated and inspected drizzle/0018_red_lethal_legion.sql and its Drizzle snapshot/journal. It adds naming state/capture/attempt/deadline/revision columns, validity checks and partial pending/running indexes, plus ai_usage.attempt_id and a partial unique conversation-title attempt index. The existing usage purpose is text with a TypeScript enum, so no PostgreSQL enum alteration is required. The migration leaves every existing row ineligible and retains that database default for mixed-version safety.

The deployment guide, environment example and Compose reference document TITLE_CONCURRENCY=2 per worker process, one-minute recovery dispatch, batches of 100, five-minute pending expiry, worker requirements, separate usage, schema-first deployment and additive rollback. Application rollback must stop title consumers/dispatcher and preserve naming columns, saved titles and usage; no historical backfill or destructive schema rollback is included.

## Changed files (44)

- `.env.example`
- `compose.yaml`
- `docs/deployment.md`
- `drizzle/0018_red_lethal_legion.sql`
- `drizzle/meta/0018_snapshot.json`
- `drizzle/meta/_journal.json`
- `e2e/titles.spec.ts`
- `openspec/changes/auto-conversation-titles/tasks.md`
- `openspec/changes/auto-conversation-titles/verification.md`
- `playwright.titles.config.ts`
- `src/components/conversation-controls.tsx`
- `src/components/conversation-list.tsx`
- `src/fns/conversations.ts`
- `src/fns/library.ts`
- `src/hooks/use-naming-metadata.test.tsx`
- `src/hooks/use-naming-metadata.ts`
- `src/lib/naming-poller.test.ts`
- `src/lib/naming-poller.ts`
- `src/modules/conversation/chat.ts`
- `src/modules/conversation/index.ts`
- `src/modules/conversation/repository.ts`
- `src/modules/conversation/schema.ts`
- `src/modules/conversation/service.int.test.ts`
- `src/modules/conversation/title-metadata.int.test.ts`
- `src/modules/conversation/title-metadata.ts`
- `src/modules/conversation/title-process.int.test.ts`
- `src/modules/conversation/title.int.test.ts`
- `src/modules/conversation/title.test.ts`
- `src/modules/conversation/title.ts`
- `src/modules/conversation/usage.ts`
- `src/modules/usage/conversation.ts`
- `src/modules/usage/index.ts`
- `src/modules/usage/record.ts`
- `src/modules/usage/schema.ts`
- `src/modules/usage/usage.int.test.ts`
- `src/routes/api/chat.ts`
- `src/routes/c.$conversationId.tsx`
- `src/routes/conversations.test.tsx`
- `src/server/boot.ts`
- `src/server/config.test.ts`
- `src/server/config.ts`
- `src/server/jobs/handlers.ts`
- `src/server/jobs/kinds.ts`
- `test/title-worker.ts`

## Remaining work

None within this change. Review and any later commit, archive or deployment remain with the coordinator/user.
