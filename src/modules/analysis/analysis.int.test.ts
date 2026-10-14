import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { editions } from "#/modules/library";
import { recordUsage, usageForEdition } from "#/modules/usage";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { ingestBook, tempDataDir } from "../../../test/library";
import {
	getBookMap,
	getPreprocessStatus,
	hasCurrentPreprocessing,
	lookupObservations,
	markDerivedStale,
	saveUnitResult,
	unitObservations,
	unitSummaries,
	updateRun,
} from ".";

let t: TestDb;
let editionId: string;

const unit = (n: number, end: number, names: string[] = ["Anna"]) => ({
	unitOrdinal: n,
	unitLabel: `Chapter ${n + 1}`,
	endPosition: end,
	summary: `Summary ${n}`,
	summaryCitations: [],
	observations: names.map((name) => ({
		name,
		kind: "character" as const,
		note: `${name} in ${n}`,
		citations: [{ locator: "x", quote: "q", verified: true }],
	})),
	model: "m",
});

beforeAll(async () => {
	t = await createTestDb();
	const book = await ingestBook(
		t.db,
		await tempDataDir(),
		await buildEpub({
			title: "Analysis Book",
			language: "en",
			chapters: [{ href: "a.xhtml", title: "One", body: "<p>Text.</p>" }],
		}),
		"analysis.epub",
	);
	editionId = book.id;
	await saveUnitResult(t.db, editionId, unit(0, 10));
	await saveUnitResult(t.db, editionId, unit(1, 20, ["ANNA!", "Bob"]));
	await saveUnitResult(t.db, editionId, unit(2, 30));
});

describe("bounded reads", () => {
	it("returns units ending at or before the bound, in order", async () => {
		const map = await getBookMap(t.db, editionId, 20);
		expect(map.map((u) => u.unitOrdinal)).toEqual([0, 1]);
	});

	it("hides a unit when the bound falls inside it", async () => {
		const map = await getBookMap(t.db, editionId, 19);
		expect(map.map((u) => u.unitOrdinal)).toEqual([0]);
		const obs = await lookupObservations(t.db, editionId, "Anna", 19, 10);
		expect(obs.map((o) => o.unitOrdinal)).toEqual([0]);
	});

	it("null bound returns everything", async () => {
		expect(await getBookMap(t.db, editionId, null)).toHaveLength(3);
	});

	it("profile cannot leak past the bound", async () => {
		const obs = await lookupObservations(t.db, editionId, "anna", 20, 10);
		expect(obs.every((o) => o.endPosition <= 20)).toBe(true);
		expect(obs).toHaveLength(2);
		expect(await lookupObservations(t.db, editionId, "Bob", 10, 10)).toEqual(
			[],
		);
	});

	it("caps results", async () => {
		expect(
			await lookupObservations(t.db, editionId, "Anna", null, 1),
		).toHaveLength(1);
	});

	it("replaces a unit transactionally", async () => {
		await saveUnitResult(t.db, editionId, unit(2, 30, ["Cleo"]));
		expect(
			await lookupObservations(t.db, editionId, "Anna", null, 10),
		).toHaveLength(2);
		expect(
			await lookupObservations(t.db, editionId, "Cleo", null, 10),
		).toHaveLength(1);
	});
});

describe("status and staleness", () => {
	it("reports complete, then stale, and hides stale rows", async () => {
		await updateRun(t.db, editionId, { status: "complete", totalUnits: 3 });
		expect((await getPreprocessStatus(t.db, editionId)).status).toBe(
			"complete",
		);
		expect(await hasCurrentPreprocessing(t.db, editionId)).toBe(true);
		await markDerivedStale(t.db, editionId);
		expect(await getBookMap(t.db, editionId, null)).toEqual([]);
		expect(await lookupObservations(t.db, editionId, "Anna", null, 10)).toEqual(
			[],
		);
		expect(await hasCurrentPreprocessing(t.db, editionId)).toBe(false);
		expect((await getPreprocessStatus(t.db, editionId)).status).toBe("stale");
		await saveUnitResult(t.db, editionId, unit(0, 10));
		expect(await getBookMap(t.db, editionId, null)).toHaveLength(1);
	});

	it("reports running progress", async () => {
		await updateRun(t.db, editionId, { status: "running", doneUnits: 1 });
		const s = await getPreprocessStatus(t.db, editionId);
		expect(s.status).toBe("running");
		expect(s.totalUnits).toBe(3);
	});
});

describe("usage and cascade", () => {
	it("totals preprocess usage per edition", async () => {
		const row = {
			purpose: "preprocess" as const,
			conversationId: null,
			editionId,
			messageId: null,
			provider: "p",
			model: "m",
			inputTokens: 5,
			outputTokens: 2,
			cacheReadTokens: null,
			cacheWriteTokens: null,
			reasoningTokens: null,
			steps: 1,
			complete: true,
		};
		await recordUsage(t.db, row);
		await recordUsage(t.db, row);
		const [total] = await usageForEdition(t.db, editionId);
		expect(total?.inputTokens).toBe(10);
	});

	it("cascades on edition delete", async () => {
		await t.db.delete(editions).where(eq(editions.id, editionId));
		for (const table of [unitSummaries, unitObservations]) {
			expect(await t.db.select().from(table)).toEqual([]);
		}
		expect(await getPreprocessStatus(t.db, editionId)).toMatchObject({
			status: "not_started",
		});
		expect(await usageForEdition(t.db, editionId)).toEqual([]);
	});
});
