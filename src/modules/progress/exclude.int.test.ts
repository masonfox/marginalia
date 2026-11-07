import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type ParsedEdition, parseEpub } from "#/modules/epub";
import {
	getReadingPosition,
	readingPositions,
	setReadingPosition,
} from "#/modules/guide";
import { editions } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { ingestBook, tempDataDir } from "../../../test/library";
import {
	getProvider,
	getSyncStatus,
	manualLink,
	type ProgressProvider,
	type ProgressReading,
	type ProviderBook,
	saveProviderConfig,
	setSyncExcluded,
	syncBook,
	syncProvider,
} from ".";

const secret = Buffer.alloc(32, 7).toString("base64");

let t: TestDb;
let dataDir: string;
let parsed: ParsedEdition;
let n = 0;

/** Hardcover's list, faked: one book whose reading each test sets. */
const list = vi.fn<(cfg: Record<string, string>) => Promise<ProviderBook[]>>();
const hardcover: ProgressProvider = {
	...getProvider("hardcover"),
	matching: { mode: "list", list },
};
const deps = () => ({ db: t.db, secret, provider: () => hardcover });

const reports = (reading: ProgressReading) =>
	list.mockResolvedValue([
		{ externalId: "hc-1", isbns: [], ids: {}, title: "A book", reading },
	]);

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	parsed = await parseEpub(await fixtures.nestedToc());
	const saved = await saveProviderConfig(t.db, secret, "hardcover", {
		enabled: true,
		values: { token: "hc-token-0123456789" },
	});
	expect(saved.status).toBe("ok");
});

beforeEach(() => {
	list.mockReset();
});

/** A new ready edition linked by hand to Hardcover's book "hc-1". */
async function linkedBook(): Promise<string> {
	const bytes = Buffer.concat([
		await fixtures.nestedToc(),
		Buffer.from(`exclude-${n++}`),
	]);
	const { id } = await ingestBook(t.db, dataDir, bytes, `exclude-${n}.epub`, {
		parse: async () => parsed,
	});
	await manualLink(t.db, "hardcover", "hc-1", id);
	return id;
}

const source = async (id: string) =>
	(
		await t.db
			.select({ source: readingPositions.source })
			.from(readingPositions)
			.where(eq(readingPositions.editionId, id))
	)[0]?.source;

describe("per-book opt-out", () => {
	it("leaves an excluded book's position alone, and applies the current reading once included", async () => {
		const id = await linkedBook();
		reports({ state: "reading", fraction: 0.95 });
		expect(await syncBook(deps(), id)).toMatchObject({ status: "synced" });
		const before = await getReadingPosition(t.db, id);
		expect(before).not.toBeNull();
		expect(await source(id)).toBe("hardcover");

		expect(await setSyncExcluded(t.db, id, true)).toBe(true);
		const [row] = await t.db
			.select({ excluded: editions.progressSyncExcluded })
			.from(editions)
			.where(eq(editions.id, id));
		expect(row?.excluded).toBe(true);
		expect((await getSyncStatus(t.db, id))?.excluded).toBe(true);

		// Hardcover reports new progress: neither a book nor a provider sync changes it.
		reports({ state: "finished" });
		expect(await syncBook(deps(), id)).toEqual({ status: "excluded" });
		await syncProvider(deps(), "hardcover");
		expect(await getReadingPosition(t.db, id)).toEqual(before);

		expect(await setSyncExcluded(t.db, id, false)).toBe(true);
		expect(await syncBook(deps(), id)).toMatchObject({
			status: "synced",
			providers: [{ kind: "hardcover", status: "applied" }],
		});
		expect(await getReadingPosition(t.db, id)).toEqual({ kind: "finished" });
		expect(await source(id)).toBe("hardcover");
	});

	it("applies an unchanged reading over a position set by hand while excluded", async () => {
		const id = await linkedBook();
		reports({ state: "reading", fraction: 0.95 });
		await syncBook(deps(), id);
		const synced = await getReadingPosition(t.db, id);

		await setSyncExcluded(t.db, id, true);
		const set = await setReadingPosition(t.db, id, { kind: "whole" });
		expect(set.set).toBe(true);
		expect(await source(id)).toBe("manual");

		// Hardcover still reports the reading it did before the exclusion.
		await setSyncExcluded(t.db, id, false);
		expect(await syncBook(deps(), id)).toMatchObject({
			providers: [{ kind: "hardcover", status: "applied" }],
		});
		expect(await getReadingPosition(t.db, id)).toEqual(synced);
		expect(await source(id)).toBe("hardcover");
	});

	it("reports an edition that does not exist", async () => {
		expect(
			await setSyncExcluded(t.db, "00000000-0000-4000-8000-0000000000ff", true),
		).toBe(false);
	});
});
