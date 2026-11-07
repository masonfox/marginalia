// Running progress syncs (design D7): one provider's whole sync, or one
// book's readings from every provider linked to it. A provider that is
// disabled or not fully configured makes no network requests.
import { and, asc, eq, exists, gt, isNotNull, or, sql } from "drizzle-orm";
import { maskSecrets } from "#/modules/ai";
import { conversationEditions, conversations } from "#/modules/conversation";
import { readerNotes, readingPositions } from "#/modules/guide";
import { type Edition, editions } from "#/modules/library";
import type { Database, Executor } from "#/server/db";
import {
	DeferJobError,
	type Enqueue,
	NonRetryableError,
} from "#/server/jobs/kinds";
import { applyReading } from "./apply";
import { getProviderConfig, loadProviderConfig } from "./config-store";
import { ProviderError, RateLimitedError } from "./errors";
import { linkByKey, matchProviderBooks } from "./matching";
import { getProvider } from "./registry";
import { progressLinks, progressProviders } from "./schema";
import {
	PROVIDER_KINDS,
	type ProgressProvider,
	type ProgressReading,
	type ProviderConfig,
	type ProviderKind,
} from "./types";

/** How recently a book must have been used to be looked up without a link or position. */
export const LOOKUP_RECENT_DAYS = 90;
/** Wait after a rate limit that named no retry time. */
const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_MESSAGE_LENGTH = 200;

export interface SyncDeps {
	db: Database;
	/** The instance secret key, to decrypt provider secrets. */
	secret: string;
	/** Resolves a provider adapter by kind; defaults to the registry. Tests pass fakes. */
	provider?: (kind: ProviderKind) => ProgressProvider;
	signal?: AbortSignal;
}

export type ProviderSyncResult =
	| {
			status: "skipped";
			reason: "disabled" | "not-configured" | "unreadable";
	  }
	/** `matched`: linked books seen this run; `applied`: positions it changed. */
	| { status: "synced"; matched: number; applied: number }
	| { status: "rate-limited"; retryAfterMs: number }
	| { status: "failed"; message: string };

/** One provider's outcome in a book sync. */
export interface BookProviderResult {
	kind: ProviderKind;
	status:
		| "applied"
		| "unchanged"
		| "excluded"
		| "not-source"
		| "no-structure"
		| "not-linked"
		| "no-reading"
		| "not-configured"
		| "rate-limited"
		| "failed";
	message?: string;
	retryAfterMs?: number;
}

export type BookSyncResult =
	| { status: "not-found" }
	| { status: "excluded" }
	| { status: "synced"; providers: BookProviderResult[] };

export function isProviderKind(kind: string): kind is ProviderKind {
	return (PROVIDER_KINDS as readonly string[]).includes(kind);
}

/**
 * Editions a lookup-mode provider asks about (design D2): ready, not
 * excluded, and either already linked to this provider, or with a KOReader
 * digest and a reading position or recent use. Nothing records opening a
 * book, so recent use is a conversation about it or a reader note on it
 * updated in the last `LOOKUP_RECENT_DAYS` days. Linked editions come with
 * their link's external id, which is their lookup key.
 */
export async function lookupCandidates(
	db: Executor,
	kind: ProviderKind,
	now: Date = new Date(),
): Promise<{ edition: Edition; externalId: string | null }[]> {
	const since = new Date(now.getTime() - LOOKUP_RECENT_DAYS * 86_400_000);
	const recent = or(
		exists(
			db
				.select({ one: sql`1` })
				.from(readingPositions)
				.where(eq(readingPositions.editionId, editions.id)),
		),
		exists(
			db
				.select({ one: sql`1` })
				.from(conversationEditions)
				.innerJoin(
					conversations,
					eq(conversations.id, conversationEditions.conversationId),
				)
				.where(
					and(
						eq(conversationEditions.editionId, editions.id),
						gt(conversations.updatedAt, since),
					),
				),
		),
		exists(
			db
				.select({ one: sql`1` })
				.from(readerNotes)
				.where(
					and(
						eq(readerNotes.editionId, editions.id),
						gt(readerNotes.updatedAt, since),
					),
				),
		),
	);
	const rows = await db
		.select({ edition: editions, externalId: progressLinks.externalId })
		.from(editions)
		.leftJoin(
			progressLinks,
			and(
				eq(progressLinks.editionId, editions.id),
				eq(progressLinks.providerKind, kind),
			),
		)
		.where(
			and(
				eq(editions.status, "ready"),
				eq(editions.progressSyncExcluded, false),
				or(
					isNotNull(progressLinks.externalId),
					and(isNotNull(editions.koreaderDigest), recent),
				),
			),
		)
		.orderBy(asc(editions.createdAt), asc(editions.id));
	return rows;
}

/** A short failure message a reader can act on; never contains secrets. */
export function syncFailureMessage(label: string, err: unknown): string {
	if (err instanceof ProviderError) {
		switch (err.reason) {
			case "unreachable":
				return `${label} could not be reached. Check its address and that it is running.`;
			case "rejected":
				return `${label} rejected the credentials. Check them in Settings.`;
			case "rate-limited":
				return `${label} is rate limiting requests. The sync will resume later.`;
			case "invalid-response":
				return `${label} sent a response Marginalia could not read.`;
		}
	}
	if (
		err instanceof Error &&
		(err.name === "TimeoutError" ||
			(err instanceof TypeError && /fetch failed/i.test(err.message)))
	) {
		return `${label} could not be reached. Check its address and that it is running.`;
	}
	const detail = maskSecrets(
		err instanceof Error ? err.message : String(err),
	).slice(0, MAX_MESSAGE_LENGTH);
	return `${label} sync failed: ${detail}`;
}

async function record(
	db: Executor,
	kind: ProviderKind,
	set: Partial<
		Pick<
			typeof progressProviders.$inferInsert,
			"lastSyncAt" | "lastSyncMatched" | "lastError"
		>
	>,
) {
	await db
		.update(progressProviders)
		.set(set)
		.where(eq(progressProviders.kind, kind));
}

type Ready =
	| { status: "ok"; config: ProviderConfig }
	| { status: "skipped"; reason: "disabled" | "not-configured" | "unreadable" };

/** The provider's plaintext config, or why it must not sync. */
async function readyConfig(deps: SyncDeps, kind: ProviderKind): Promise<Ready> {
	const view = await getProviderConfig(deps.db, deps.secret, kind);
	if (!view.saved || !view.enabled)
		return { status: "skipped", reason: "disabled" };
	if (view.unreadable) return { status: "skipped", reason: "unreadable" };
	if (!view.configured) return { status: "skipped", reason: "not-configured" };
	const loaded = await loadProviderConfig(deps.db, deps.secret, kind);
	if (loaded.status === "ok") return { status: "ok", config: loaded.config };
	return {
		status: "skipped",
		reason: loaded.status === "unreadable" ? "unreadable" : "disabled",
	};
}

/**
 * Runs one provider's sync. List mode fetches the reader's books, matches
 * them and applies each linked book's reading; lookup mode asks about each
 * candidate edition, linking it when the provider knows it. Records the
 * outcome on the provider row: `last_sync_at` and `last_sync_matched` on
 * success, and `last_error` (null on success). A rate limit ends the run
 * early so the caller can run it again later.
 */
export async function syncProvider(
	deps: SyncDeps,
	kind: ProviderKind,
): Promise<ProviderSyncResult> {
	const { db } = deps;
	const provider = (deps.provider ?? getProvider)(kind);
	const ready = await readyConfig(deps, kind);
	if (ready.status === "skipped") {
		if (ready.reason === "unreadable")
			await record(db, kind, {
				lastError: `${provider.label}'s saved secrets cannot be read. Enter them again in Settings.`,
			});
		else if (ready.reason === "not-configured")
			await record(db, kind, {
				lastError: `${provider.label} is missing required settings.`,
			});
		return ready;
	}
	const cfg = ready.config;
	let matched = 0;
	let applied = 0;
	try {
		const { matching } = provider;
		if (matching.mode === "list") {
			const books = await matching.list(cfg);
			const linked = await matchProviderBooks(db, kind, books);
			matched = linked.length;
			for (const { editionId, book } of linked) {
				deps.signal?.throwIfAborted();
				const result = await applyReading(db, editionId, kind, book.reading);
				if (result.status === "applied") applied++;
			}
		} else {
			for (const { edition, externalId } of await lookupCandidates(db, kind)) {
				deps.signal?.throwIfAborted();
				const key = externalId ?? (await matching.keyFor(edition));
				if (!key) continue;
				const reading = await matching.get(cfg, key);
				if (!reading) continue;
				if (!externalId && !(await linkByKey(db, edition.id, kind, key)))
					continue;
				matched++;
				const result = await applyReading(db, edition.id, kind, reading);
				if (result.status === "applied") applied++;
			}
		}
	} catch (err) {
		if (deps.signal?.aborted) throw err;
		if (err instanceof RateLimitedError) {
			await record(db, kind, {
				lastError: syncFailureMessage(provider.label, err),
			});
			return {
				status: "rate-limited",
				retryAfterMs: err.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
			};
		}
		const message = syncFailureMessage(provider.label, err);
		await record(db, kind, { lastError: message });
		return { status: "failed", message };
	}
	await record(db, kind, {
		lastSyncAt: new Date(),
		lastSyncMatched: matched,
		lastError: null,
	});
	return { status: "synced", matched, applied };
}

/**
 * Fetches one book's reading from every enabled, configured provider linked
 * to it (a lookup provider also tries the edition's own key when not yet
 * linked) and applies each; `applyReading` decides which one is the source.
 * Provider rows' sync status is left alone.
 */
export async function syncBook(
	deps: SyncDeps,
	editionId: string,
): Promise<BookSyncResult> {
	const { db } = deps;
	const [edition] = await db
		.select()
		.from(editions)
		.where(eq(editions.id, editionId));
	if (!edition) return { status: "not-found" };
	if (edition.progressSyncExcluded) return { status: "excluded" };
	const [providers, links] = await Promise.all([
		db
			.select({ kind: progressProviders.kind })
			.from(progressProviders)
			.where(eq(progressProviders.enabled, true))
			.orderBy(asc(progressProviders.priority)),
		db
			.select()
			.from(progressLinks)
			.where(eq(progressLinks.editionId, editionId)),
	]);
	const results: BookProviderResult[] = [];
	for (const { kind } of providers) {
		if (!isProviderKind(kind)) continue;
		deps.signal?.throwIfAborted();
		const provider = (deps.provider ?? getProvider)(kind);
		const link = links.find((l) => l.providerKind === kind);
		if (provider.matching.mode === "list" && !link) continue;
		const ready = await readyConfig(deps, kind);
		if (ready.status === "skipped") {
			if (link) results.push({ kind, status: "not-configured" });
			continue;
		}
		try {
			let reading: ProgressReading | null = null;
			const { matching } = provider;
			if (matching.mode === "list") {
				const books = await matching.list(ready.config);
				reading =
					books.find((b) => b.externalId === link?.externalId)?.reading ?? null;
			} else {
				const key = link?.externalId ?? (await matching.keyFor(edition));
				if (!key) continue;
				reading = await matching.get(ready.config, key);
				if (reading && !link && !(await linkByKey(db, editionId, kind, key)))
					reading = null;
			}
			if (!reading) {
				if (link) results.push({ kind, status: "no-reading" });
				continue;
			}
			const applied = await applyReading(db, editionId, kind, reading);
			results.push({ kind, status: applied.status });
		} catch (err) {
			if (deps.signal?.aborted) throw err;
			results.push(
				err instanceof RateLimitedError
					? {
							kind,
							status: "rate-limited",
							retryAfterMs: err.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
							message: syncFailureMessage(provider.label, err),
						}
					: {
							kind,
							status: "failed",
							message: syncFailureMessage(provider.label, err),
						},
			);
		}
	}
	return { status: "synced", providers: results };
}

/** The `progress-sync` job: a rate limit defers the whole run. */
export async function runProviderSyncJob(
	deps: SyncDeps,
	kind: string,
): Promise<ProviderSyncResult> {
	if (!isProviderKind(kind))
		throw new NonRetryableError(`Unknown progress provider "${kind}".`);
	const result = await syncProvider(deps, kind);
	if (result.status === "rate-limited")
		throw new DeferJobError(result.retryAfterMs, `${kind} rate limited`);
	return result;
}

/**
 * The `progress-sync-book` job. A rate limit defers it; another provider
 * failure fails it with that provider's message.
 */
export async function runBookSyncJob(
	deps: SyncDeps,
	editionId: string,
): Promise<BookSyncResult> {
	const result = await syncBook(deps, editionId);
	if (result.status !== "synced") return result;
	const limited = result.providers.filter((p) => p.status === "rate-limited");
	if (limited.length > 0)
		throw new DeferJobError(
			Math.max(...limited.map((p) => p.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS)),
			"rate limited",
		);
	const failed = result.providers.filter((p) => p.status === "failed");
	if (failed.length > 0)
		throw new Error(failed.map((p) => p.message).join(" "));
	return result;
}

/** Queues a provider sync. `queued` is false when one is already pending or running. */
export async function enqueueProviderSync(
	enqueue: Enqueue,
	kind: ProviderKind,
): Promise<{ queued: boolean }> {
	return { queued: (await enqueue("progress-sync", { kind })) !== null };
}

/** Queues a one-book sync. `queued` is false when one is already pending or running. */
export async function enqueueBookSync(
	enqueue: Enqueue,
	editionId: string,
): Promise<{ queued: boolean }> {
	return {
		queued: (await enqueue("progress-sync-book", { editionId })) !== null,
	};
}
