import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { clearSecrets, registerSecret } from "#/modules/ai";
import { JobRuntime } from "./runtime";

const editionId = "00000000-0000-4000-8000-000000000000";

/** A pg-boss stand-in whose findJobs pages oldest first, like the real one. */
function fakeBoss(states: string[], onPage?: (after?: string) => void) {
	let rows = states.map((state, i) => ({ id: `job-${i}`, state }));
	const cancelled: string[] = [];
	const boss = {
		cancelled,
		drop(id: string) {
			rows = rows.filter((r) => r.id !== id);
		},
		async findJobs(
			_kind: string,
			opts: { key?: string; after?: string; limit?: number } = {},
		) {
			onPage?.(opts.after);
			let from = 0;
			if (opts.after !== undefined) {
				const at = rows.findIndex((r) => r.id === opts.after);
				if (at < 0)
					throw new Error("findJobs: after names a row that no longer exists");
				from = at + 1;
			}
			return rows.slice(from, from + (opts.limit ?? 1000));
		},
		async cancel(_kind: string, ids: string[]) {
			cancelled.push(...ids);
			return { affected: ids.length, settled: ids };
		},
	};
	return boss;
}

function runtime(boss: ReturnType<typeof fakeBoss>) {
	const Ctor = JobRuntime as unknown as new (
		boss: unknown,
		log: unknown,
	) => JobRuntime;
	return new Ctor(boss, pino({ level: "silent" }));
}

const history = (n: number) => Array.from({ length: n }, () => "completed");

describe("JobRuntime failed jobs", () => {
	afterEach(() => clearSecrets());

	it("masks secrets in the job output and the logged error", async () => {
		const secret = `gsk_${"Zp4".repeat(14)}`;
		registerSecret(secret);
		const logged: object[] = [];
		const log = {
			child: () => log,
			debug() {},
			warn(o: object) {
				logged.push(o);
			},
		};
		const Ctor = JobRuntime as unknown as new (
			boss: unknown,
			log: unknown,
		) => JobRuntime;
		const rt = new Ctor(fakeBoss([]), log) as unknown as {
			run(
				kind: string,
				handler: () => Promise<void>,
				job: object,
			): Promise<{ status: string; output?: { message: string } }>;
		};
		const result = await rt.run(
			"analysis.preprocess",
			async () => {
				throw Object.assign(new Error(`bad token ${secret}`), {
					requestBodyValues: { apiKey: secret },
					cause: new Error(secret),
				});
			},
			{
				id: "job-1",
				data: { editionId },
				retryCount: 0,
				retryLimit: 2,
				signal: new AbortController().signal,
			},
		);
		expect(result.status).toBe("failed");
		expect(result.output?.message).toBe("bad token [redacted]");
		expect(logged).toHaveLength(1);
		expect(JSON.stringify(logged)).not.toContain(secret);
		expect(JSON.stringify(logged)).toContain("[redacted]");
	});
});

describe("JobRuntime live job lookup", () => {
	it("finds a live job behind more than a page of retained jobs", async () => {
		const queued = fakeBoss([...history(1000), "created"]);
		expect(
			await runtime(queued).pendingJob("analysis.preprocess", { editionId }),
		).toBe("queued");
		const active = fakeBoss([...history(2500), "active"]);
		expect(
			await runtime(active).pendingJob("analysis.preprocess", { editionId }),
		).toBe("active");
		const boss = fakeBoss([...history(1000), "retry"]);
		expect(
			await runtime(boss).cancelJob("analysis.preprocess", { editionId }),
		).toEqual(["job-1000"]);
		expect(boss.cancelled).toEqual(["job-1000"]);
	});

	it("rescans when maintenance deletes the page anchor", async () => {
		let dropped = false;
		const boss = fakeBoss([...history(1500), "created"], (after) => {
			if (after !== undefined && !dropped) {
				dropped = true;
				boss.drop(after);
			}
		});
		expect(
			await runtime(boss).pendingJob("analysis.preprocess", { editionId }),
		).toBe("queued");
		expect(dropped).toBe(true);
	});
});
