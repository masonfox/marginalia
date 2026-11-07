import { z } from "zod";
import { AI_PROVIDERS, type Config } from "../config";

/**
 * Every background job kind: payload schema, deduplication key, retry policy,
 * and per-process concurrency. Kept free of module imports so any module can
 * enqueue without creating import cycles; handlers are wired in `runtime.ts`.
 */
export const jobKinds = {
	"conversation.title": {
		payload: z.object({ conversationId: z.uuid() }).strict(),
		key: (p: { conversationId: string }) => p.conversationId,
		retryLimit: 2,
		concurrency: (c: JobConfig) => c.titleConcurrency ?? 2,
	},
	"conversation.dispatch-titles": {
		payload: z.object({}).strict(),
		key: () => "titles",
		retryLimit: 2,
		concurrency: () => 1,
	},
	"library.scan": {
		payload: z.object({
			/** Ignore the (size, mtime) cache and re-hash every file. */
			full: z.boolean().default(false),
		}),
		key: () => "library",
		retryLimit: 2,
		concurrency: () => 1,
	},
	"library.ingest": {
		payload: z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
		key: (p: { sha256: string }) => p.sha256,
		retryLimit: 4,
		concurrency: (c: JobConfig) => c.ingestConcurrency,
	},
	/** One-off: fills editions.koreader_digest for editions ingested before it existed. */
	"library.backfill-koreader-digest": {
		payload: z.object({}).strict(),
		key: () => "koreader-digest",
		retryLimit: 2,
		concurrency: () => 1,
	},
	"catalog.reparse": {
		payload: z.object({ editionId: z.uuid() }),
		key: (p: { editionId: string }) => p.editionId,
		retryLimit: 4,
		concurrency: (c: JobConfig) => c.ingestConcurrency,
	},
	"analysis.preprocess": {
		payload: z.object({
			editionId: z.uuid(),
			/**
			 * The model every attempt uses, fixed at enqueue. Absent on jobs queued
			 * before runs carried one; those use the default when they start.
			 */
			provider: z.enum(AI_PROVIDERS).optional(),
			model: z.string().min(1).optional(),
		}),
		key: (p: { editionId: string }) => p.editionId,
		retryLimit: 2,
		// Fixed at 1 to bound spend.
		concurrency: () => 1,
	},
	/**
	 * One progress provider's sync. The key makes it at most one pending or
	 * running per provider; the handler checks `kind` against the registry.
	 */
	"progress-sync": {
		payload: z.object({ kind: z.string().min(1) }).strict(),
		key: (p: { kind: string }) => p.kind,
		retryLimit: 1,
		// One per kind comes from the key; different providers may overlap.
		concurrency: () => 2,
	},
	/** Every linked provider's reading for one book. */
	"progress-sync-book": {
		payload: z.object({ editionId: z.uuid() }).strict(),
		key: (p: { editionId: string }) => p.editionId,
		retryLimit: 1,
		concurrency: () => 2,
	},
	"access.purge-sessions": {
		payload: z.object({}),
		key: () => "sessions",
		retryLimit: 2,
		concurrency: () => 1,
	},
} as const;

export type JobConfig = Pick<Config, "ingestConcurrency"> &
	Partial<Pick<Config, "titleConcurrency">>;
export type JobKind = keyof typeof jobKinds;
export type JobPayload<K extends JobKind> = z.input<
	(typeof jobKinds)[K]["payload"]
>;
export type ParsedJobPayload<K extends JobKind> = z.output<
	(typeof jobKinds)[K]["payload"]
>;

export const jobKindNames = Object.keys(jobKinds) as JobKind[];

/**
 * Throw from a handler for failures that retrying cannot fix (corrupt archive,
 * DRM). The job fails immediately with this message as its recorded error.
 */
export class NonRetryableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "NonRetryableError";
	}
}

/**
 * Throw from a handler to stop now and run the same job again after
 * `delayMs`, such as when a provider rate-limits. The job completes instead
 * of failing, so no retry is spent, and the follow-up keeps the job's key.
 */
export class DeferJobError extends Error {
	readonly delayMs: number;

	constructor(delayMs: number, message = "Job deferred.") {
		super(message);
		this.name = "DeferJobError";
		this.delayMs = delayMs;
	}
}

/**
 * Sets (`cron`) or removes (null) the recurring job of this kind under
 * `key`. Each firing enqueues `payload` with the kind's dedupe key. It only
 * writes the database, so a process that runs no workers can call it.
 */
export type ScheduleJob = <K extends JobKind>(
	kind: K,
	key: string,
	cron: string | null,
	payload?: JobPayload<K>,
) => Promise<void>;

export interface JobContext {
	id: string;
	/** 0 on the first attempt. */
	retryCount: number;
	/** True when this is the last attempt before the job is marked failed. */
	finalAttempt: boolean;
	signal: AbortSignal;
}

export type JobHandler<K extends JobKind> = (
	payload: ParsedJobPayload<K>,
	ctx: JobContext,
) => Promise<void>;

export type JobHandlers = { [K in JobKind]?: JobHandler<K> };

/** Enqueues jobs; returns the job id, or null when a job with the same kind and key is already pending or running. */
export type Enqueue = <K extends JobKind>(
	kind: K,
	payload: JobPayload<K>,
) => Promise<string | null>;

/**
 * The pending job with this kind and key: "queued" while it waits (including
 * between retries), "active" while a worker has it, null when there is none.
 */
export type PendingJob = <K extends JobKind>(
	kind: K,
	payload: JobPayload<K>,
) => Promise<"queued" | "active" | null>;

/**
 * The pending job with this kind and key and its payload, or null when there
 * is none. The payload is null when this version cannot read it.
 */
export type PendingJobDetail = <K extends JobKind>(
	kind: K,
	payload: JobPayload<K>,
) => Promise<{
	state: "queued" | "active";
	payload: ParsedJobPayload<K> | null;
} | null>;

/**
 * Cancels the pending job with this kind and key, waiting or running, so it
 * is not retried. A running handler's signal aborts at the worker's next
 * heartbeat. Returns the ids of the jobs it cancelled, empty when none.
 */
export type CancelJob = <K extends JobKind>(
	kind: K,
	payload: JobPayload<K>,
) => Promise<string[]>;
