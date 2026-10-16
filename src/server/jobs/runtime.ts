import { type Job, PgBoss } from "pg-boss";
import { maskSecrets, redactSecrets } from "#/modules/ai";
import type { Logger } from "../logger";
import {
	type CancelJob,
	type Enqueue,
	type JobConfig,
	type JobHandler,
	type JobHandlers,
	type JobKind,
	jobKindNames,
	jobKinds,
	NonRetryableError,
	type PendingJob,
	type PendingJobDetail,
} from "./kinds";

export interface RetryPolicy {
	/** Initial delay in seconds; doubles on each retry. */
	retryDelay: number;
	retryDelayMax: number;
	retryLimit?: number;
}

export interface JobRuntimeOptions {
	connectionString: string;
	config: JobConfig;
	log: Logger;
	/** Whether this process executes jobs. When false it only enqueues. */
	worker: boolean;
	handlers: JobHandlers;
	/** Recurring jobs: kind → cron expression or RFC 5545 rule. Null unschedules. */
	schedules?: Partial<Record<JobKind, string | null>>;
	retry?: Partial<RetryPolicy>;
	/** Seconds between polls when idle. */
	pollingIntervalSeconds?: number;
	/** Seconds between a running job's claim checks, so how soon a cancelled job aborts. */
	heartbeatRefreshSeconds?: number;
	/** How often due schedules are checked, in seconds (pg-boss default 30). */
	cronIntervalSeconds?: number;
	schema?: string;
}

const defaultRetry: RetryPolicy = { retryDelay: 5, retryDelayMax: 300 };
/** Jobs per findJobs page when scanning a key's history. */
const FIND_PAGE = 1000;
/** Scans of a key's history before a vanished page anchor is rethrown. */
const FIND_ATTEMPTS = 3;

/** Every `minutes` minutes, or null when 0 disables the schedule. */
export function everyMinutes(minutes: number): string | null {
	return minutes > 0 ? `FREQ=MINUTELY;INTERVAL=${minutes}` : null;
}

/** What is logged of a failed job's error: no cause or provider fields, secrets masked. */
function maskedError(err: unknown) {
	if (!(err instanceof Error)) return { message: maskSecrets(String(err)) };
	return {
		type: err.name,
		message: maskSecrets(err.message),
		stack: err.stack && maskSecrets(err.stack),
	};
}

export class JobRuntime {
	private constructor(
		readonly boss: PgBoss,
		private readonly log: Logger,
	) {}

	static async start(options: JobRuntimeOptions): Promise<JobRuntime> {
		const { log, worker } = options;
		const boss = new PgBoss({
			connectionString: options.connectionString,
			schema: options.schema ?? "pgboss",
			application_name: "marginalia",
			// Only workers do maintenance and fire schedules; web-only processes just enqueue.
			supervise: worker,
			schedule: worker,
			// pg-boss validates any key that is present, so omit unset ones.
			...(options.cronIntervalSeconds !== undefined && {
				cronWorkerIntervalSeconds: options.cronIntervalSeconds,
				cronMonitorIntervalSeconds: options.cronIntervalSeconds,
			}),
		});
		boss.on("error", (err) => log.error({ err }, "job queue error"));
		await boss.start();
		const runtime = new JobRuntime(boss, log);

		const retry = { ...defaultRetry, ...options.retry };
		for (const kind of jobKindNames) {
			const def = jobKinds[kind];
			const queueOptions = {
				policy: "exclusive" as const,
				retryLimit: retry.retryLimit ?? def.retryLimit,
				retryDelay: retry.retryDelay,
				retryBackoff: true,
				retryDelayMax: retry.retryDelayMax,
				heartbeatSeconds: 60,
			};
			if (await boss.getQueue(kind)) {
				const { policy: _policy, ...updatable } = queueOptions;
				await boss.updateQueue(kind, updatable);
			} else {
				await boss.createQueue(kind, queueOptions);
			}
		}

		if (worker) {
			for (const [kind, expression] of Object.entries(
				options.schedules ?? {},
			)) {
				if (expression) {
					await boss.schedule(kind, expression, {}, { key: "default" });
				} else {
					await boss.unschedule(kind, "default");
				}
			}
			for (const kind of jobKindNames) {
				const handler = options.handlers[kind];
				if (handler) {
					await runtime.work(kind, handler as JobHandler<JobKind>, options);
				}
			}
			log.info("background job worker started");
		} else {
			log.info("background job worker disabled in this process");
		}
		return runtime;
	}

	private async work(
		kind: JobKind,
		handler: JobHandler<JobKind>,
		options: JobRuntimeOptions,
	) {
		const def = jobKinds[kind];
		await this.boss.work(
			kind,
			{
				batchSize: 1,
				localConcurrency: def.concurrency(options.config),
				pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
				heartbeatRefreshSeconds: options.heartbeatRefreshSeconds ?? 5,
				includeMetadata: true,
				perJobResults: true,
			},
			async (jobs) => {
				const results = [];
				for (const job of jobs) {
					results.push(await this.run(kind, handler, job));
				}
				return results;
			},
		);
	}

	private async run(
		kind: JobKind,
		handler: JobHandler<JobKind>,
		job: Job<unknown> & { retryLimit: number },
	) {
		const log = this.log.child({
			job: kind,
			jobId: job.id,
			attempt: job.retryCount + 1,
		});
		try {
			const payload = jobKinds[kind].payload.parse(job.data ?? {});
			await handler(payload as never, {
				id: job.id,
				retryCount: job.retryCount,
				finalAttempt: job.retryCount >= job.retryLimit,
				signal: job.signal,
			});
			log.debug("job completed");
			return { id: job.id, status: "completed" as const };
		} catch (err) {
			const message = redactSecrets(
				err instanceof Error ? err.message : String(err),
			);
			const nonRetryable = err instanceof NonRetryableError;
			log.warn({ err: maskedError(err), nonRetryable }, "job failed");
			return {
				id: job.id,
				status: nonRetryable ? ("deadletter" as const) : ("failed" as const),
				output: { message },
			};
		}
	}

	enqueue: Enqueue = async (kind, payload) => {
		const def = jobKinds[kind];
		const parsed = def.payload.parse(payload);
		const key = (def.key as (p: unknown) => string)(parsed);
		return this.boss.send(kind, parsed, { singletonKey: key });
	};

	/**
	 * Created, retrying and active jobs for the payload's key. Pages through the
	 * key's whole history, which keeps finished jobs until maintenance deletes
	 * them; if maintenance deletes a page's anchor mid-scan, the scan restarts.
	 */
	private async liveJobs(kind: JobKind, payload: unknown) {
		const def = jobKinds[kind];
		const key = (def.key as (p: unknown) => string)(def.payload.parse(payload));
		for (let attempt = 1; ; attempt++) {
			const live: { id: string; state: string; data?: unknown }[] = [];
			let after: string | undefined;
			try {
				for (;;) {
					const page = await this.boss.findJobs(kind, {
						key,
						after,
						limit: FIND_PAGE,
					});
					live.push(
						...page.filter(
							(j) =>
								j.state === "created" ||
								j.state === "retry" ||
								j.state === "active",
						),
					);
					if (page.length < FIND_PAGE) return live;
					after = page[page.length - 1]?.id;
				}
			} catch (err) {
				const anchorGone =
					after !== undefined &&
					err instanceof Error &&
					err.message.includes("no longer exists");
				if (!anchorGone || attempt >= FIND_ATTEMPTS) throw err;
			}
		}
	}

	pendingJob: PendingJob = async (kind, payload) =>
		(await this.pendingJobDetail(kind, payload))?.state ?? null;

	pendingJobDetail: PendingJobDetail = async (kind, payload) => {
		const jobs = await this.liveJobs(kind, payload);
		const job = jobs.find((j) => j.state === "active") ?? jobs[0];
		if (!job) return null;
		const parsed = jobKinds[kind].payload.safeParse(job.data ?? {});
		return {
			state: job.state === "active" ? "active" : "queued",
			payload: parsed.success ? (parsed.data as never) : null,
		};
	};

	cancelJob: CancelJob = async (kind, payload) => {
		const ids = (await this.liveJobs(kind, payload)).map((j) => j.id);
		if (ids.length === 0) return [];
		// pg-boss returns the cancelled ids as `settled` but types the response as an empty interface.
		const result = (await this.boss.cancel(kind, ids)) as {
			settled?: string[];
		};
		return result.settled ?? [];
	};

	/** Stops polling and waits up to `timeoutMs` for running jobs to finish. */
	async stop(timeoutMs = 30_000): Promise<void> {
		await this.boss.stop({ graceful: true, timeout: timeoutMs, close: true });
	}
}
