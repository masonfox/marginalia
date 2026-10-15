import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDatabase } from "../../../test/db";
import { sleep, waitFor } from "../../../test/wait";
import {
	type JobHandlers,
	type JobKind,
	JobRuntime,
	type JobRuntimeOptions,
	NonRetryableError,
} from ".";

const log = pino({ level: "silent" });
/** pg-boss's internal queue for scheduled occurrences (timekeeper QUEUES.SEND_IT). */
const SEND_IT = "__pgboss__send-it";
const sha = (n: number) => n.toString(16).padStart(64, "0");
const running: JobRuntime[] = [];

afterEach(async () => {
	await Promise.all(running.splice(0).map((r) => r.stop(5_000)));
});

async function start(
	url: string,
	handlers: JobHandlers,
	options: Partial<JobRuntimeOptions> = {},
) {
	const runtime = await JobRuntime.start({
		connectionString: url,
		config: { ingestConcurrency: 2 },
		log,
		worker: true,
		handlers,
		retry: { retryDelay: 1, retryDelayMax: 1 },
		pollingIntervalSeconds: 0.5,
		...options,
	});
	running.push(runtime);
	return runtime;
}

async function jobs(runtime: JobRuntime, kind: JobKind) {
	return runtime.boss.findJobs<unknown>(kind);
}

describe("job runtime", () => {
	it("enqueues, processes, and completes a job", async () => {
		const url = await createEmptyDatabase();
		const seen: string[] = [];
		const runtime = await start(url, {
			"library.ingest": async (p) => {
				seen.push(p.sha256);
			},
		});
		const id = await runtime.enqueue("library.ingest", { sha256: sha(1) });
		expect(id).toBeTruthy();
		const [job] = await waitFor(
			async () => {
				const all = await jobs(runtime, "library.ingest");
				return all[0]?.state === "completed" && all;
			},
			{ what: "job completion" },
		);
		expect(job?.id).toBe(id);
		expect(seen).toEqual([sha(1)]);
	});

	it("rejects an invalid payload at enqueue time", async () => {
		const url = await createEmptyDatabase();
		const runtime = await start(url, {});
		await expect(
			runtime.enqueue("library.ingest", { sha256: "not-a-hash" }),
		).rejects.toThrow();
	});

	it("retries a transient failure and then completes", async () => {
		const url = await createEmptyDatabase();
		const attempts: number[] = [];
		const runtime = await start(url, {
			"library.ingest": async (_p, ctx) => {
				attempts.push(ctx.retryCount);
				if (ctx.retryCount === 0) throw new Error("database blip");
			},
		});
		await runtime.enqueue("library.ingest", { sha256: sha(2) });
		await waitFor(
			async () =>
				(await jobs(runtime, "library.ingest"))[0]?.state === "completed",
			{ what: "completion after retry" },
		);
		expect(attempts).toEqual([0, 1]);
	});

	it("marks a permanently failing job failed with its last error", async () => {
		const url = await createEmptyDatabase();
		let calls = 0;
		const finalFlags: boolean[] = [];
		const runtime = await start(
			url,
			{
				"library.ingest": async (_p, ctx) => {
					calls++;
					finalFlags.push(ctx.finalAttempt);
					throw new Error(`attempt ${ctx.retryCount + 1} failed`);
				},
			},
			{ retry: { retryDelay: 1, retryDelayMax: 1, retryLimit: 2 } },
		);
		await runtime.enqueue("library.ingest", { sha256: sha(3) });
		const job = await waitFor(
			async () => {
				const [j] = await jobs(runtime, "library.ingest");
				return j?.state === "failed" && j;
			},
			{ what: "terminal failure" },
		);
		expect(calls).toBe(3);
		expect(finalFlags).toEqual([false, false, true]);
		expect(job.output).toEqual({ message: "attempt 3 failed" });
	});

	it("fails immediately on NonRetryableError", async () => {
		const url = await createEmptyDatabase();
		let calls = 0;
		const runtime = await start(url, {
			"library.ingest": async () => {
				calls++;
				throw new NonRetryableError("DRM-protected content is not supported");
			},
		});
		await runtime.enqueue("library.ingest", { sha256: sha(4) });
		const job = await waitFor(
			async () => {
				const [j] = await jobs(runtime, "library.ingest");
				return j?.state === "failed" && j;
			},
			{ what: "immediate failure" },
		);
		await sleep(2_000);
		expect(calls).toBe(1);
		expect(job.retryCount).toBe(0);
		expect(job.output).toEqual({
			message: "DRM-protected content is not supported",
		});
	});

	it("configures exponential backoff on every queue", async () => {
		const url = await createEmptyDatabase();
		const runtime = await start(url, {});
		const queue = await runtime.boss.getQueue("library.ingest");
		expect(queue).toMatchObject({ retryBackoff: true, retryLimit: 4 });
	});

	it("runs no more ingestion jobs at once than the configured concurrency", async () => {
		const url = await createEmptyDatabase();
		let active = 0;
		let peak = 0;
		let done = 0;
		const runtime = await start(url, {
			"library.ingest": async () => {
				active++;
				peak = Math.max(peak, active);
				await sleep(400);
				active--;
				done++;
			},
		});
		for (let i = 10; i < 16; i++) {
			await runtime.enqueue("library.ingest", { sha256: sha(i) });
		}
		await waitFor(() => done === 6, { what: "all jobs", timeoutMs: 30_000 });
		expect(peak).toBe(2);
	});

	it("deduplicates jobs with the same kind and key", async () => {
		const url = await createEmptyDatabase();
		const runtime = await start(url, {}, { worker: false });
		const first = await runtime.enqueue("library.ingest", { sha256: sha(5) });
		const second = await runtime.enqueue("library.ingest", { sha256: sha(5) });
		const other = await runtime.enqueue("library.ingest", { sha256: sha(6) });
		expect(first).toBeTruthy();
		expect(second).toBeNull();
		expect(other).toBeTruthy();
		const scanA = await runtime.enqueue("library.scan", {});
		const scanB = await runtime.enqueue("library.scan", { full: true });
		expect(scanA).toBeTruthy();
		expect(scanB).toBeNull();
		expect(await jobs(runtime, "library.ingest")).toHaveLength(2);
	});

	it("does not dedupe against a job that already finished", async () => {
		const url = await createEmptyDatabase();
		const runtime = await start(url, { "library.ingest": async () => {} });
		await runtime.enqueue("library.ingest", { sha256: sha(7) });
		await waitFor(
			async () =>
				(await jobs(runtime, "library.ingest"))[0]?.state === "completed",
		);
		expect(
			await runtime.enqueue("library.ingest", { sha256: sha(7) }),
		).toBeTruthy();
	});

	it("reports a pending job per key: queued with no worker, then active, then none", async () => {
		const url = await createEmptyDatabase();
		const editionId = randomUUID();
		const web = await start(url, {}, { worker: false });
		expect(await web.pendingJob("analysis.preprocess", { editionId })).toBe(
			null,
		);
		expect(
			await web.enqueue("analysis.preprocess", { editionId }),
		).toBeTruthy();
		expect(await web.pendingJob("analysis.preprocess", { editionId })).toBe(
			"queued",
		);
		// A duplicate enqueue is refused but the accepted job stays visible.
		expect(await web.enqueue("analysis.preprocess", { editionId })).toBeNull();
		expect(await web.pendingJob("analysis.preprocess", { editionId })).toBe(
			"queued",
		);
		expect(
			await web.pendingJob("analysis.preprocess", { editionId: randomUUID() }),
		).toBe(null);

		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		await start(url, { "analysis.preprocess": () => gate });
		await waitFor(
			async () =>
				(await web.pendingJob("analysis.preprocess", { editionId })) ===
				"active",
			{ what: "job to become active" },
		);
		release();
		await waitFor(
			async () =>
				(await web.pendingJob("analysis.preprocess", { editionId })) === null,
			{ what: "job to finish" },
		);
	});

	it("enqueues but does not process jobs when the worker is disabled", async () => {
		const url = await createEmptyDatabase();
		let calls = 0;
		const runtime = await start(
			url,
			{
				"library.ingest": async () => {
					calls++;
				},
			},
			{ worker: false },
		);
		expect(
			await runtime.enqueue("library.ingest", { sha256: sha(8) }),
		).toBeTruthy();
		await sleep(3_000);
		expect(calls).toBe(0);
		expect((await jobs(runtime, "library.ingest"))[0]?.state).toBe("created");

		// A worker process on the same database picks it up.
		await start(url, {
			"library.ingest": async () => {
				calls++;
			},
		});
		await waitFor(() => calls === 1, { what: "worker pickup" });
	});

	it("waits for running jobs on graceful stop", async () => {
		const url = await createEmptyDatabase();
		let finished = false;
		let started = false;
		const runtime = await start(url, {
			"library.ingest": async () => {
				started = true;
				await sleep(1_500);
				finished = true;
			},
		});
		await runtime.enqueue("library.ingest", { sha256: sha(9) });
		await waitFor(() => started, { what: "job start" });
		running.splice(running.indexOf(runtime), 1);
		await runtime.stop(10_000);
		expect(finished).toBe(true);
	});

	it("runs a scheduled job once per interval across two worker instances", async () => {
		const url = await createEmptyDatabase();
		const runs: number[] = [];
		const options: Partial<JobRuntimeOptions> = {
			schedules: { "library.scan": "FREQ=SECONDLY;INTERVAL=4" },
			cronIntervalSeconds: 1,
		};
		const record = async () => void runs.push(Date.now());
		const a = await start(url, { "library.scan": record }, options);
		await start(url, { "library.scan": record }, options);
		// pg-boss evaluates schedules in claimed passes (~30 s apart), so allow time for two.
		await waitFor(() => runs.length >= 2, {
			timeoutMs: 100_000,
			what: "two scheduled runs",
		});
		await sleep(2_000);

		// pg-boss forwards each occurrence through its internal send-it queue,
		// filed under the one-minute slot it falls in; a unique index on
		// (name, singletonOn, singletonKey) keeps one forward per slot however
		// many instances run the pass. The slot is what identifies an occurrence:
		// the scan job itself carries no trace of it, and its timestamps include
		// worker polling delay. Two genuine occurrences can run moments apart when
		// the first pass's window spans a slot boundary, so spacing proves nothing.
		const created = await jobs(a, "library.scan");
		const forwarded = (await a.boss.findJobs<{ name: string }>(SEND_IT)).filter(
			(job) => job.data.name === "library.scan",
		);
		const slots = forwarded.map((job) => job.singletonOn?.getTime());
		expect(slots).not.toContain(undefined);
		expect(new Set(slots).size).toBe(forwarded.length);
		// Every scan job traces to a forwarded occurrence (a forward can yield
		// none when the exclusive queue drops it); an instance-local schedule
		// would send scan jobs pg-boss never forwarded, once per instance.
		expect(created.length).toBeLessThanOrEqual(forwarded.length);
		expect(created.length).toBe(runs.length);
	}, 120_000);
});
