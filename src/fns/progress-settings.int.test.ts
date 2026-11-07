import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { editions, ensureEdition } from "#/modules/library";
import {
	progressLinks,
	progressUnmatched,
	SYNC_CRON,
} from "#/modules/progress";
import { loadConfig } from "#/server/config";
import { type AppContext, setAppContext } from "#/server/context";
import { JobRuntime } from "#/server/jobs";
import { createTestDb, type TestDb } from "../../test/db";

// Call the real handlers; createServerFn is reduced to its handler.
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const builder = {
			validator: (_schema: unknown) => builder,
			handler:
				(handler: (args: { data: unknown }) => unknown) =>
				(args?: { data: unknown }) =>
					handler(args ?? { data: undefined }),
		};
		return builder;
	},
}));

import {
	linkUnmatchedBookFn,
	listSyncProvidersFn,
	listUnmatchedBooksFn,
	reorderSyncProvidersFn,
	saveSyncProviderFn,
	searchEditionsFn,
	setSyncProviderEnabledFn,
	setSyncScheduleFn,
	syncProviderNowFn,
	testSyncProviderFn,
	unlinkBookFn,
} from "./progress-settings";

const TOKEN = "hc-saved-token-wxyz";
let t: TestDb;
let runtime: JobRuntime;
const config = loadConfig({
	DATABASE_URL: "postgres://unused",
	MARGINALIA_SECRET_KEY: Buffer.alloc(32, 3).toString("base64"),
});

beforeAll(async () => {
	t = await createTestDb();
	// A web-only process: it queues and schedules jobs but runs none.
	runtime = await JobRuntime.start({
		connectionString: t.url,
		config: { ingestConcurrency: 1 },
		log: pino({ level: "silent" }),
		worker: false,
		handlers: {},
	});
	setAppContext({
		db: t.db,
		config,
		enqueue: runtime.enqueue,
		scheduleJob: runtime.scheduleJob,
	} as AppContext);
});

afterAll(async () => {
	await runtime.stop(5_000);
});

beforeEach(async () => {
	await t.pool.query("delete from progress_providers");
	await t.pool.query("delete from pgboss.job where name like 'progress-sync%'");
	for (const s of await runtime.boss.getSchedules("progress-sync"))
		await runtime.boss.unschedule("progress-sync", s.key);
});

afterEach(() => vi.unstubAllGlobals());

async function edition(title: string): Promise<string> {
	const { edition } = await ensureEdition(
		t.db,
		randomBytes(32).toString("hex"),
		title,
	);
	await t.db
		.update(editions)
		.set({ status: "ready" })
		.where(eq(editions.id, edition.id));
	return edition.id;
}

async function saveHardcover(enabled = false) {
	const result = await saveSyncProviderFn({
		data: { kind: "hardcover", values: { token: TOKEN }, enabled },
	});
	expect(result.status).toBe("ok");
}

async function providers() {
	return listSyncProvidersFn();
}

describe("reading sync server functions", () => {
	it("lists every provider with its form fields and help, hints only", async () => {
		await saveHardcover();
		const list = await providers();
		expect(list.map((p) => p.kind).sort()).toEqual(["bookorbit", "hardcover"]);
		const hc = list.find((p) => p.kind === "hardcover");
		expect(hc?.configFields.map((f) => [f.key, f.type])).toEqual([
			["token", "secret"],
		]);
		expect(hc?.help).toBeTruthy();
		// Where to find the token is said once, by the field.
		expect(hc?.configFields[0]?.hint).toContain("hardcover.app/account/api");
		expect(hc?.help).not.toContain("hardcover.app");
		expect(hc?.secrets.token).toEqual({ set: true, hint: "wxyz" });
		expect(JSON.stringify(list)).not.toContain(TOKEN);

		// A blank secret keeps the saved one.
		await saveSyncProviderFn({
			data: { kind: "hardcover", values: { token: "" } },
		});
		const again = (await providers()).find((p) => p.kind === "hardcover");
		expect(again?.secrets.token).toEqual({ set: true, hint: "wxyz" });
		expect(JSON.stringify(again)).not.toContain(TOKEN);
	});

	it("refuses to turn on a provider missing required settings", async () => {
		const result = await setSyncProviderEnabledFn({
			data: { kind: "bookorbit", enabled: true },
		});
		expect(result.status).toBe("invalid");
		const saved = await saveSyncProviderFn({
			data: {
				kind: "bookorbit",
				values: { url: "http://bookorbit.test" },
				enabled: true,
			},
		});
		expect(saved.status).toBe("invalid");
		const bo = (await providers()).find((p) => p.kind === "bookorbit");
		expect(bo?.enabled).toBe(false);
		expect(bo?.values.url).toBe("http://bookorbit.test");
	});

	it("applies schedule changes at once and unschedules a disabled provider", async () => {
		await saveHardcover(true);
		const schedules = async () =>
			(await runtime.boss.getSchedules("progress-sync")).map((s) => [
				s.key,
				s.cron,
			]);
		expect(await schedules()).toEqual([]);
		await setSyncScheduleFn({ data: { kind: "hardcover", schedule: "24h" } });
		expect(await schedules()).toEqual([["hardcover", SYNC_CRON["24h"]]]);
		await setSyncScheduleFn({ data: { kind: "hardcover", schedule: "6h" } });
		expect(await schedules()).toEqual([["hardcover", SYNC_CRON["6h"]]]);
		await setSyncProviderEnabledFn({
			data: { kind: "hardcover", enabled: false },
		});
		expect(await schedules()).toEqual([]);
	});

	it("reorders priorities, giving unsaved providers a place", async () => {
		await saveHardcover();
		expect((await providers()).map((p) => [p.kind, p.priority])).toEqual([
			["hardcover", 1],
			["bookorbit", null],
		]);
		expect(
			await reorderSyncProvidersFn({
				data: { order: ["bookorbit", "hardcover"] },
			}),
		).toEqual({ status: "ok" });
		expect((await providers()).map((p) => [p.kind, p.priority])).toEqual([
			["bookorbit", 1],
			["hardcover", 2],
		]);
		const bo = (await providers()).find((p) => p.kind === "bookorbit");
		expect(bo).toMatchObject({ saved: true, enabled: false });

		await reorderSyncProvidersFn({
			data: { order: ["hardcover", "bookorbit"] },
		});
		expect((await providers()).map((p) => [p.kind, p.priority])).toEqual([
			["hardcover", 1],
			["bookorbit", 2],
		]);
		expect(
			await reorderSyncProvidersFn({ data: { order: ["hardcover"] } }),
		).toEqual({ status: "invalid" });
	});

	it("tests unsaved values over the saved secret and reports the reason", async () => {
		await saveHardcover();
		const seen: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: unknown, init?: RequestInit) => {
				seen.push(new Headers(init?.headers).get("authorization") ?? "");
				return new Response("nope", { status: 401 });
			}),
		);
		const blank = await testSyncProviderFn({
			data: { kind: "hardcover", values: { token: "" } },
		});
		expect(blank).toMatchObject({ status: "rejected" });
		expect(blank.message).toBe("Hardcover rejected the credentials.");
		// "Hardcover rejected the API token" would only say it again.
		expect("detail" in blank && blank.detail).toBeFalsy();
		expect(seen.at(-1)).toBe(`Bearer ${TOKEN}`);
		expect(JSON.stringify(blank)).not.toContain(TOKEN);

		const typed = await testSyncProviderFn({
			data: { kind: "hardcover", values: { token: "hc-typed-token-1234" } },
		});
		expect(typed.status).toBe("rejected");
		expect(seen.at(-1)).toBe("Bearer hc-typed-token-1234");

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed");
			}),
		);
		const down = await testSyncProviderFn({
			data: {
				kind: "bookorbit",
				values: {
					url: "http://bookorbit.invalid",
					username: "reader",
					key: "kosync-key",
				},
			},
		});
		expect(down).toMatchObject({ status: "unreachable" });
		// Testing stores nothing.
		const bo = (await providers()).find((p) => p.kind === "bookorbit");
		expect(bo?.saved).toBe(false);

		expect(
			(await testSyncProviderFn({ data: { kind: "bookorbit", values: {} } }))
				.status,
		).toBe("invalid");
	});

	it("queues Sync now once while one is pending", async () => {
		expect(await syncProviderNowFn({ data: { kind: "hardcover" } })).toEqual({
			status: "disabled",
		});
		await saveHardcover(true);
		expect(await syncProviderNowFn({ data: { kind: "hardcover" } })).toEqual({
			status: "queued",
		});
		expect(await syncProviderNowFn({ data: { kind: "hardcover" } })).toEqual({
			status: "already-queued",
		});
		expect(await runtime.boss.findJobs("progress-sync")).toHaveLength(1);
	});

	it("links an unmatched book by hand, removing it from the list", async () => {
		await saveHardcover();
		const id = await edition("The Linked Book");
		await t.db.insert(progressUnmatched).values({
			providerKind: "hardcover",
			externalId: "hc-77",
			title: "Linked Book",
			reading: { state: "reading", fraction: 0.4 },
		});
		expect((await listUnmatchedBooksFn()).map((b) => b.externalId)).toEqual([
			"hc-77",
		]);
		const found = await searchEditionsFn({ data: { q: "linked" } });
		expect(found.map((e) => e.id)).toContain(id);

		expect(
			await linkUnmatchedBookFn({
				data: { kind: "hardcover", externalId: "hc-77", editionId: id },
			}),
		).toEqual({ status: "ok" });
		expect(await listUnmatchedBooksFn()).toEqual([]);
		const [link] = await t.db
			.select()
			.from(progressLinks)
			.where(eq(progressLinks.editionId, id));
		expect(link).toMatchObject({ externalId: "hc-77", matchedBy: "manual" });

		expect(
			await linkUnmatchedBookFn({
				data: {
					kind: "hardcover",
					externalId: "hc-78",
					editionId: "00000000-0000-4000-8000-000000000000",
				},
			}),
		).toEqual({ status: "not-found" });
	});

	it("remembers an unlinked automatic match as rejected, and deletes a manual link", async () => {
		await saveHardcover();
		const auto = await edition("Auto");
		const manual = await edition("Manual");
		await t.db.insert(progressLinks).values([
			{
				editionId: auto,
				providerKind: "hardcover",
				externalId: "hc-1",
				matchedBy: "auto",
			},
			{
				editionId: manual,
				providerKind: "hardcover",
				externalId: "hc-2",
				matchedBy: "manual",
			},
		]);
		expect(
			await unlinkBookFn({ data: { kind: "hardcover", editionId: auto } }),
		).toEqual({ unlinked: true });
		expect(
			await unlinkBookFn({ data: { kind: "hardcover", editionId: manual } }),
		).toEqual({ unlinked: true });
		const rows = await t.db
			.select()
			.from(progressLinks)
			.where(eq(progressLinks.providerKind, "hardcover"));
		expect(rows.map((r) => [r.editionId, r.externalId, r.matchedBy])).toEqual([
			[auto, "hc-1", "rejected"],
		]);
		// Unlinking again finds no live link.
		expect(
			await unlinkBookFn({ data: { kind: "hardcover", editionId: auto } }),
		).toEqual({ unlinked: false });
	});
});
