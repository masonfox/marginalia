import { z } from "zod";
import type { Config } from "../config";

/**
 * Every background job kind: payload schema, deduplication key, retry policy,
 * and per-process concurrency. Kept free of module imports so any module can
 * enqueue without creating import cycles; handlers are wired in `runtime.ts`.
 */
export const jobKinds = {
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
	"catalog.reparse": {
		payload: z.object({ editionId: z.uuid() }),
		key: (p: { editionId: string }) => p.editionId,
		retryLimit: 4,
		concurrency: (c: JobConfig) => c.ingestConcurrency,
	},
	"analysis.preprocess": {
		payload: z.object({ editionId: z.uuid() }),
		key: (p: { editionId: string }) => p.editionId,
		retryLimit: 2,
		// Fixed at 1 to bound spend.
		concurrency: () => 1,
	},
	"access.purge-sessions": {
		payload: z.object({}),
		key: () => "sessions",
		retryLimit: 2,
		concurrency: () => 1,
	},
} as const;

export type JobConfig = Pick<Config, "ingestConcurrency">;
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
 * Cancels the pending job with this kind and key, waiting or running, so it
 * is not retried. A running handler's signal aborts at the worker's next
 * heartbeat. Returns the ids of the jobs it cancelled, empty when none.
 */
export type CancelJob = <K extends JobKind>(
	kind: K,
	payload: JobPayload<K>,
) => Promise<string[]>;
