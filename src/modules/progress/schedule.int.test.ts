import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobRuntime } from "#/server/jobs";
import { createTestDb, type TestDb } from "../../../test/db";
import {
	progressProviders,
	reconcileSyncSchedules,
	SYNC_CRON,
	saveProviderSettings,
} from ".";

const secret = Buffer.alloc(32, 5).toString("base64");
let t: TestDb;
let runtime: JobRuntime;

beforeAll(async () => {
	t = await createTestDb();
	// A web-only process: it runs no workers and fires no schedules, but can still set them.
	runtime = await JobRuntime.start({
		connectionString: t.url,
		config: { ingestConcurrency: 1 },
		log: pino({ level: "silent" }),
		worker: false,
		handlers: {},
	});
});

afterAll(async () => {
	await runtime.stop(5_000);
});

beforeEach(async () => {
	await t.pool.query("delete from progress_providers");
	for (const s of await runtime.boss.getSchedules("progress-sync"))
		await runtime.boss.unschedule("progress-sync", s.key);
});

async function schedules() {
	return (await runtime.boss.getSchedules("progress-sync"))
		.map((s) => ({ key: s.key, cron: s.cron, data: s.data }))
		.sort((a, b) => a.key.localeCompare(b.key));
}

const deps = () => ({ db: t.db, secret, scheduleJob: runtime.scheduleJob });

describe("provider sync schedules", () => {
	it("applies a schedule change on save, without a restart", async () => {
		const save = (input: Parameters<typeof saveProviderSettings>[2]) =>
			saveProviderSettings(deps(), "hardcover", input);
		expect((await save({ enabled: true, schedule: "24h" })).status).toBe("ok");
		expect(await schedules()).toEqual([
			{ key: "hardcover", cron: SYNC_CRON["24h"], data: { kind: "hardcover" } },
		]);

		await save({ schedule: "6h" });
		expect(await schedules()).toEqual([
			{ key: "hardcover", cron: SYNC_CRON["6h"], data: { kind: "hardcover" } },
		]);

		await save({ schedule: "manual" });
		expect(await schedules()).toEqual([]);
	});

	it("unschedules a disabled provider and leaves others alone", async () => {
		await saveProviderSettings(deps(), "hardcover", {
			enabled: true,
			schedule: "1h",
		});
		await saveProviderSettings(deps(), "bookorbit", {
			enabled: true,
			schedule: "6h",
		});
		expect((await schedules()).map((s) => s.key)).toEqual([
			"bookorbit",
			"hardcover",
		]);

		await saveProviderSettings(deps(), "hardcover", { enabled: false });
		expect(await schedules()).toEqual([
			{ key: "bookorbit", cron: SYNC_CRON["6h"], data: { kind: "bookorbit" } },
		]);
	});

	it("does not change schedules when the save is invalid", async () => {
		await saveProviderSettings(deps(), "hardcover", {
			enabled: true,
			schedule: "1h",
		});
		const result = await saveProviderSettings(deps(), "hardcover", {
			enabled: false,
			values: { nope: "x" },
		});
		expect(result.status).toBe("invalid");
		expect((await schedules()).map((s) => s.key)).toEqual(["hardcover"]);
	});

	it("reconciles schedules with stored settings at boot", async () => {
		await t.db.insert(progressProviders).values([
			{ kind: "hardcover", enabled: true, priority: 1, schedule: "1h" },
			{ kind: "bookorbit", enabled: false, priority: 2, schedule: "6h" },
		]);
		// A stale schedule from before bookorbit was disabled.
		await runtime.scheduleJob("progress-sync", "bookorbit", SYNC_CRON["6h"], {
			kind: "bookorbit",
		});
		await reconcileSyncSchedules(t.db, runtime.scheduleJob);
		expect(await schedules()).toEqual([
			{ key: "hardcover", cron: SYNC_CRON["1h"], data: { kind: "hardcover" } },
		]);
	});
});
