import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { conversationEditions, conversations } from "#/modules/conversation";
import { type ParsedEdition, parseEpub } from "#/modules/epub";
import { readerNotes, readingPositions } from "#/modules/guide";
import { editions, ensureEdition } from "#/modules/library";
import { type JobKind, JobRuntime } from "#/server/jobs";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { ingestBook, tempDataDir } from "../../../test/library";
import { waitFor } from "../../../test/wait";
import {
	enqueueBookSync,
	enqueueProviderSync,
	getProvider,
	lookupCandidates,
	type ProgressProvider,
	type ProgressReading,
	type ProviderBook,
	ProviderError,
	type ProviderKind,
	progressLinks,
	progressProviders,
	RateLimitedError,
	runBookSyncJob,
	runProviderSyncJob,
	saveProviderConfig,
} from ".";

const secret = Buffer.alloc(32, 7).toString("base64");
const log = pino({ level: "silent" });
const DAY = 86_400_000;

let t: TestDb;
let dataDir: string;
let parsed: ParsedEdition;
let n = 0;
const running: JobRuntime[] = [];

/** Fake adapters that stand in for the registry's. */
const list = vi.fn<(cfg: Record<string, string>) => Promise<ProviderBook[]>>();
const get =
	vi.fn<
		(
			cfg: Record<string, string>,
			key: string,
		) => Promise<ProgressReading | null>
	>();
const fakes: Partial<Record<ProviderKind, ProgressProvider>> = {
	hardcover: {
		...getProvider("hardcover"),
		matching: { mode: "list", list },
	},
	bookorbit: {
		...getProvider("bookorbit"),
		matching: {
			mode: "lookup",
			keyFor: async (e) => e.koreaderDigest ?? null,
			get,
		},
	},
};
const fakeProvider = (kind: ProviderKind): ProgressProvider => {
	const provider = fakes[kind];
	if (!provider) throw new Error(`no fake for ${kind}`);
	return provider;
};

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	parsed = await parseEpub(await fixtures.nestedToc());
});

beforeEach(async () => {
	list.mockReset();
	get.mockReset();
	await t.pool.query("delete from progress_providers");
	await t.pool.query("delete from reading_positions");
	// Each test counts only its own jobs; pg-boss's schema exists after the first start.
	await t.pool
		.query("delete from pgboss.job where name like 'progress-sync%'")
		.catch(() => {});
});

afterEach(async () => {
	await Promise.all(running.splice(0).map((r) => r.stop(5_000)));
});

/** A new ready edition with these identifiers and KOReader digest. */
async function book(
	over: { isbn?: string; digest?: string | null } = {},
): Promise<string> {
	const bytes = Buffer.concat([
		await fixtures.nestedToc(),
		Buffer.from(`sync-${n++}`),
	]);
	const { id } = await ingestBook(t.db, dataDir, bytes, `sync-${n}.epub`, {
		parse: async () => parsed,
	});
	await t.db
		.update(editions)
		.set({
			identifiers: over.isbn ? [{ scheme: "ISBN", value: over.isbn }] : [],
			koreaderDigest: over.digest ?? null,
		})
		.where(eq(editions.id, id));
	return id;
}

async function configure(kind: ProviderKind, enabled: boolean): Promise<void> {
	const values =
		kind === "hardcover"
			? { token: "hc-token-0123456789" }
			: {
					url: "http://bookorbit.test",
					username: "reader",
					key: "kosync-key-0123",
				};
	const saved = await saveProviderConfig(t.db, secret, kind, {
		enabled,
		values,
	});
	expect(saved.status).toBe("ok");
}

async function providerRow(kind: ProviderKind) {
	const [row] = await t.db
		.select()
		.from(progressProviders)
		.where(eq(progressProviders.kind, kind));
	return row;
}

async function position(editionId: string) {
	const [row] = await t.db
		.select()
		.from(readingPositions)
		.where(eq(readingPositions.editionId, editionId));
	return row;
}

async function start() {
	const deps = (signal: AbortSignal) => ({
		db: t.db,
		secret,
		provider: fakeProvider,
		signal,
	});
	const runtime = await JobRuntime.start({
		connectionString: t.url,
		config: { ingestConcurrency: 1 },
		log,
		worker: true,
		handlers: {
			"progress-sync": async ({ kind }, ctx) => {
				await runProviderSyncJob(deps(ctx.signal), kind);
			},
			"progress-sync-book": async ({ editionId }, ctx) => {
				await runBookSyncJob(deps(ctx.signal), editionId);
			},
		},
		retry: { retryDelay: 1, retryDelayMax: 1 },
		pollingIntervalSeconds: 0.5,
	});
	running.push(runtime);
	return runtime;
}

/** Waits until no job of this kind is waiting or running, then returns them all. */
async function settled(runtime: JobRuntime, kind: JobKind, count = 1) {
	return waitFor(
		async () => {
			const jobs = await runtime.boss.findJobs(kind);
			return (
				jobs.length >= count &&
				jobs.every((j) => ["completed", "failed"].includes(j.state)) &&
				jobs
			);
		},
		{ what: `${kind} jobs to settle` },
	);
}

const finished: ProgressReading = { state: "finished" };

describe("progress-sync job", () => {
	it("links and applies a list provider's books, and records the run", async () => {
		await configure("hardcover", true);
		const isbn = "9780000000002";
		const id = await book({ isbn });
		list.mockResolvedValue([
			{
				externalId: "hc-1",
				isbns: [isbn],
				ids: {},
				title: "A book",
				reading: finished,
			},
			{
				externalId: "hc-2",
				isbns: ["9781111111113"],
				ids: {},
				title: "Not in the library",
				reading: { state: "reading", fraction: 0.5 },
			},
		]);
		const runtime = await start();
		expect(await enqueueProviderSync(runtime.enqueue, "hardcover")).toEqual({
			queued: true,
		});
		const [job] = await settled(runtime, "progress-sync");
		expect(job?.state).toBe("completed");
		expect(list).toHaveBeenCalledTimes(1);
		expect(list.mock.calls[0]?.[0]).toMatchObject({
			token: "hc-token-0123456789",
		});
		const [link] = await t.db
			.select()
			.from(progressLinks)
			.where(eq(progressLinks.editionId, id));
		expect(link).toMatchObject({
			providerKind: "hardcover",
			externalId: "hc-1",
		});
		expect(await position(id)).toMatchObject({
			source: "hardcover",
			maxPosition: null,
		});
		const row = await providerRow("hardcover");
		expect(row?.lastSyncAt).toBeInstanceOf(Date);
		expect(row?.lastSyncMatched).toBe(1);
		expect(row?.lastError).toBeNull();
	});

	it("makes no calls for a disabled or unconfigured provider", async () => {
		await configure("hardcover", false);
		const runtime = await start();
		await enqueueProviderSync(runtime.enqueue, "bookorbit");
		await enqueueProviderSync(runtime.enqueue, "hardcover");
		await settled(runtime, "progress-sync", 2);
		expect(list).not.toHaveBeenCalled();
		expect(get).not.toHaveBeenCalled();
		const row = await providerRow("hardcover");
		expect(row?.lastSyncAt).toBeNull();
		expect(row?.lastError).toBeNull();

		// Enabled but missing its required token: still no calls.
		await saveProviderConfig(t.db, secret, "bookorbit", {
			enabled: true,
			values: { url: "http://bookorbit.test", username: "reader" },
		});
		await runProviderSyncJob(
			{ db: t.db, secret, provider: fakeProvider },
			"bookorbit",
		);
		expect(get).not.toHaveBeenCalled();
		expect((await providerRow("bookorbit"))?.lastError).toMatch(
			/missing required settings/,
		);
	});

	it("records a failure as a reader-actionable last error", async () => {
		await configure("hardcover", true);
		list.mockRejectedValue(
			new ProviderError("rejected", "Hardcover rejected the API token"),
		);
		const runtime = await start();
		await enqueueProviderSync(runtime.enqueue, "hardcover");
		await settled(runtime, "progress-sync");
		const row = await providerRow("hardcover");
		expect(row?.lastError).toBe(
			"Hardcover rejected the credentials. Check them in Settings.",
		);
		expect(row?.lastSyncAt).toBeNull();

		// The next successful run clears it.
		list.mockResolvedValue([]);
		await enqueueProviderSync(runtime.enqueue, "hardcover");
		await settled(runtime, "progress-sync", 2);
		const after = await providerRow("hardcover");
		expect(after?.lastError).toBeNull();
		expect(after?.lastSyncMatched).toBe(0);
	});

	it("collapses a duplicate enqueue while one is pending or running", async () => {
		await configure("hardcover", true);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started!: () => void;
		const running = new Promise<void>((resolve) => {
			started = resolve;
		});
		list.mockImplementation(async () => {
			started();
			await gate;
			return [];
		});
		const runtime = await start();
		expect(await enqueueProviderSync(runtime.enqueue, "hardcover")).toEqual({
			queued: true,
		});
		expect(await enqueueProviderSync(runtime.enqueue, "hardcover")).toEqual({
			queued: false,
		});
		await running;
		expect(await enqueueProviderSync(runtime.enqueue, "hardcover")).toEqual({
			queued: false,
		});
		release();
		const jobs = await settled(runtime, "progress-sync");
		expect(jobs).toHaveLength(1);
		expect(list).toHaveBeenCalledTimes(1);
	});

	it("reschedules a rate-limited run instead of failing it", async () => {
		await configure("hardcover", true);
		list
			.mockRejectedValueOnce(new RateLimitedError("429", 1_500))
			.mockResolvedValue([]);
		const runtime = await start();
		const before = Date.now();
		await enqueueProviderSync(runtime.enqueue, "hardcover");
		const jobs = await settled(runtime, "progress-sync", 2);
		expect(jobs.map((j) => j.state)).toEqual(["completed", "completed"]);
		const deferred = (o: unknown) =>
			!!o && typeof o === "object" && "deferredMs" in o;
		expect(jobs.filter((j) => deferred(j.output))).toHaveLength(1);
		const later = jobs.find((j) => !deferred(j.output));
		expect(later?.startAfter.getTime()).toBeGreaterThanOrEqual(before + 1_000);
		expect(later?.data).toEqual({ kind: "hardcover" });
		expect(list).toHaveBeenCalledTimes(2);
		expect((await providerRow("hardcover"))?.lastError).toBeNull();
	});

	it("looks up candidate editions in lookup mode and links the ones the provider knows", async () => {
		await configure("bookorbit", true);
		const known = await book({ digest: "d-known" });
		const unknown = await book({ digest: "d-unknown" });
		const idle = await book({ digest: "d-idle" });
		await t.db
			.insert(readingPositions)
			.values([{ editionId: known }, { editionId: unknown }]);
		get.mockImplementation(async (_cfg, key) =>
			key === "d-known" ? { state: "reading", fraction: 0 } : null,
		);
		await runProviderSyncJob(
			{ db: t.db, secret, provider: fakeProvider },
			"bookorbit",
		);
		const asked = get.mock.calls.map(([, key]) => key);
		expect(asked).toContain("d-known");
		expect(asked).toContain("d-unknown");
		expect(asked).not.toContain("d-idle");
		const links = await t.db
			.select()
			.from(progressLinks)
			.where(eq(progressLinks.providerKind, "bookorbit"));
		expect(links.map((l) => [l.editionId, l.externalId])).toEqual([
			[known, "d-known"],
		]);
		expect((await providerRow("bookorbit"))?.lastSyncMatched).toBe(1);
		expect(idle).toBeTruthy();
	});
});

describe("progress-sync-book job", () => {
	it("syncs every enabled provider linked to the book", async () => {
		await configure("bookorbit", true);
		await configure("hardcover", true);
		const id = await book({ digest: "d-book" });
		await t.db.insert(progressLinks).values({
			editionId: id,
			providerKind: "hardcover",
			externalId: "hc-9",
			matchedBy: "manual",
		});
		list.mockResolvedValue([
			{
				externalId: "hc-9",
				isbns: [],
				ids: {},
				title: "Linked",
				reading: finished,
			},
		]);
		get.mockResolvedValue(null);
		const runtime = await start();
		expect(await enqueueBookSync(runtime.enqueue, id)).toEqual({
			queued: true,
		});
		const [job] = await settled(runtime, "progress-sync-book");
		expect(job?.state).toBe("completed");
		// BookOrbit was asked by the edition's digest, and knew nothing.
		expect(get).toHaveBeenCalledWith(expect.anything(), "d-book");
		expect(await position(id)).toMatchObject({ source: "hardcover" });
		// A book sync leaves the providers' sync status alone.
		expect((await providerRow("hardcover"))?.lastSyncAt).toBeNull();
	});

	it("records a failed book sync on its link until a later sync succeeds", async () => {
		await configure("hardcover", true);
		const id = await book();
		await t.db.insert(progressLinks).values({
			editionId: id,
			providerKind: "hardcover",
			externalId: "hc-7",
			matchedBy: "manual",
		});
		const link = async () => {
			const [row] = await t.db
				.select()
				.from(progressLinks)
				.where(eq(progressLinks.editionId, id));
			return row;
		};
		const deps = { db: t.db, secret, provider: fakeProvider };

		list.mockRejectedValue(
			new ProviderError("rejected", "Hardcover rejected the API token"),
		);
		await expect(runBookSyncJob(deps, id)).rejects.toThrow(
			"Hardcover rejected the credentials. Check them in Settings.",
		);
		const failed = await link();
		expect(failed?.lastError).toBe(
			"Hardcover rejected the credentials. Check them in Settings.",
		);
		expect(failed?.lastAttemptAt).toBeInstanceOf(Date);

		// A rate limit defers the job and is not a failure: nothing recorded.
		list.mockRejectedValue(new RateLimitedError("429", 1_000));
		await expect(runBookSyncJob(deps, id)).rejects.toThrow("rate limited");
		expect(await link()).toMatchObject({
			lastError: failed?.lastError,
			lastAttemptAt: failed?.lastAttemptAt,
		});

		// An error that is not a provider's own keeps no secret.
		list.mockRejectedValue(new Error("boom with token hc-token-0123456789"));
		await expect(runBookSyncJob(deps, id)).rejects.toThrow();
		expect((await link())?.lastError).not.toContain("hc-token-0123456789");

		list.mockResolvedValue([
			{
				externalId: "hc-7",
				isbns: [],
				ids: {},
				title: "Linked",
				reading: finished,
			},
		]);
		await runBookSyncJob(deps, id);
		const cleared = await link();
		expect(cleared?.lastError).toBeNull();
		expect(cleared?.lastAttemptAt?.getTime()).toBeGreaterThanOrEqual(
			failed?.lastAttemptAt?.getTime() ?? Number.POSITIVE_INFINITY,
		);
		expect((await providerRow("hardcover"))?.lastError).toBeNull();
	});

	it("records a linked provider whose secrets cannot be read", async () => {
		await configure("hardcover", true);
		const id = await book();
		await t.db.insert(progressLinks).values({
			editionId: id,
			providerKind: "hardcover",
			externalId: "hc-8",
			matchedBy: "manual",
		});
		await runBookSyncJob(
			{
				db: t.db,
				secret: Buffer.alloc(32, 9).toString("base64"),
				provider: fakeProvider,
			},
			id,
		);
		const [row] = await t.db
			.select()
			.from(progressLinks)
			.where(eq(progressLinks.editionId, id));
		expect(row?.lastError).toBe(
			"Hardcover's saved secrets cannot be read. Enter them again in Settings.",
		);
		expect(list).not.toHaveBeenCalled();
	});

	it("clears a book's failure when a provider sync reads its link", async () => {
		await configure("hardcover", true);
		const id = await book();
		await t.db.insert(progressLinks).values({
			editionId: id,
			providerKind: "hardcover",
			externalId: "hc-6",
			matchedBy: "manual",
			lastError: "Hardcover rejected the credentials. Check them in Settings.",
		});
		list.mockResolvedValue([
			{
				externalId: "hc-6",
				isbns: [],
				ids: {},
				title: "Linked",
				reading: finished,
			},
		]);
		await runProviderSyncJob(
			{ db: t.db, secret, provider: fakeProvider },
			"hardcover",
		);
		const [row] = await t.db
			.select()
			.from(progressLinks)
			.where(eq(progressLinks.editionId, id));
		expect(row?.lastError).toBeNull();
		expect(row?.lastAttemptAt).toBeInstanceOf(Date);
	});
});

describe("lookupCandidates", () => {
	const sha = () => randomBytes(32).toString("hex");

	async function edition(
		over: Partial<typeof editions.$inferInsert> = {},
	): Promise<string> {
		const { edition } = await ensureEdition(t.db, sha(), "Candidate");
		await t.db
			.update(editions)
			.set({ status: "ready", koreaderDigest: sha().slice(0, 32), ...over })
			.where(eq(editions.id, edition.id));
		return edition.id;
	}

	async function conversationOn(editionId: string, updatedAt: Date) {
		const [c] = await t.db
			.insert(conversations)
			.values({ title: "Talk", updatedAt })
			.returning();
		if (!c) throw new Error("no conversation");
		await t.db
			.insert(conversationEditions)
			.values({ conversationId: c.id, editionId, ordinal: 0 });
	}

	async function noteOn(editionId: string, updatedAt: Date) {
		await t.db.insert(readerNotes).values({
			editionId,
			title: "Note",
			body: "",
			asOfKind: "end",
			updatedAt,
		});
	}

	it("selects linked, positioned and recently used editions only", async () => {
		await t.pool.query("delete from editions");
		await configure("bookorbit", true);
		const now = new Date();
		const ago = (days: number) => new Date(now.getTime() - days * DAY);

		const linkedNoDigest = await edition({ koreaderDigest: null });
		await t.db.insert(progressLinks).values({
			editionId: linkedNoDigest,
			providerKind: "bookorbit",
			externalId: "manual-key",
			matchedBy: "manual",
		});
		const positioned = await edition();
		const positionedNoDigest = await edition({ koreaderDigest: null });
		await t.db
			.insert(readingPositions)
			.values([{ editionId: positioned }, { editionId: positionedNoDigest }]);
		const talkedRecently = await edition();
		await conversationOn(talkedRecently, ago(10));
		const talkedLongAgo = await edition();
		await conversationOn(talkedLongAgo, ago(120));
		const notedRecently = await edition();
		await noteOn(notedRecently, ago(89));
		const notedLongAgo = await edition();
		await noteOn(notedLongAgo, ago(91));
		const excluded = await edition({ progressSyncExcluded: true });
		await t.db.insert(readingPositions).values({ editionId: excluded });
		const processing = await edition({ status: "processing" });
		await t.db.insert(readingPositions).values({ editionId: processing });
		await edition(); // never used

		const picked = await lookupCandidates(t.db, "bookorbit", now);
		expect(new Map(picked.map((c) => [c.edition.id, c.externalId]))).toEqual(
			new Map<string, string | null>([
				[linkedNoDigest, "manual-key"],
				[positioned, null],
				[talkedRecently, null],
				[notedRecently, null],
			]),
		);
		// Another provider's link does not make the edition a candidate.
		expect(
			(await lookupCandidates(t.db, "hardcover", now)).map((c) => c.edition.id),
		).not.toContain(linkedNoDigest);
	});

	it("treats a rejected link as no link, and never asks about the rejected pair", async () => {
		await t.pool.query("delete from editions");
		await configure("bookorbit", true);
		const now = new Date();
		const rejectedOnly = await edition({ koreaderDigest: "d-rej-only" });
		const rejectedUsed = await edition({ koreaderDigest: "d-rej-used" });
		await t.db.insert(readingPositions).values({ editionId: rejectedUsed });
		await t.db.insert(progressLinks).values([
			{
				editionId: rejectedOnly,
				providerKind: "bookorbit",
				externalId: "d-rej-only",
				matchedBy: "rejected",
			},
			{
				editionId: rejectedUsed,
				providerKind: "bookorbit",
				externalId: "d-rej-used",
				matchedBy: "rejected",
			},
		]);
		const picked = await lookupCandidates(t.db, "bookorbit", now);
		expect(
			picked.map((c) => [c.edition.id, c.externalId, c.rejectedId]),
		).toEqual([[rejectedUsed, null, "d-rej-used"]]);

		get.mockResolvedValue({ state: "finished" });
		const deps = { db: t.db, secret, provider: fakeProvider };
		await runProviderSyncJob(deps, "bookorbit");
		await runBookSyncJob(deps, rejectedUsed);
		expect(get).not.toHaveBeenCalled();
		expect(await position(rejectedUsed)).toMatchObject({ source: "manual" });
	});
});
