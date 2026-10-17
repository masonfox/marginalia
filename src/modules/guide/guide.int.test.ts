import { beforeAll, describe, expect, it } from "vitest";
import { saveUnitResult, unitSummaries } from "#/modules/analysis";
import { passages } from "#/modules/catalog";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { ingestBook, tempDataDir } from "../../../test/library";
import { getUnitAnchors, unitAnchorsCache } from ".";

let t: TestDb;
let book: { id: string; shortId: string };

beforeAll(async () => {
	t = await createTestDb();
	book = await ingestBook(
		t.db,
		await tempDataDir(),
		await fixtures.nestedToc(),
		"guide-units.epub",
	);
});

const machineRow = (unitOrdinal: number, endPosition: number) => ({
	unitOrdinal,
	unitLabel: `Unit ${unitOrdinal}`,
	endPosition,
	summary: `Summary ${unitOrdinal}`,
	summaryCitations: [],
	observations: [],
	model: "m",
});

describe("getUnitAnchors", () => {
	it("maps each unit ordinal to the locator of its first passage", async () => {
		const anchors = await getUnitAnchors(t.db, book.id);
		expect(anchors.units).toHaveLength(3);
		const rows = await t.db
			.select({ locator: passages.locator, position: passages.position })
			.from(passages);
		const locatorAt = new Map(rows.map((r) => [r.position, r.locator]));
		for (const unit of anchors.units) {
			const locator = anchors.locatorOf(unit.ordinal);
			expect(locator).toBe(locatorAt.get(unit.startPosition));
			expect(anchors.unitAt(locator as string)).toBe(unit);
		}
		expect(anchors.locatorOf(3)).toBeNull();
		// A passage that does not start a unit anchors nothing.
		const inner = locatorAt.get((anchors.units[0]?.startPosition ?? 0) + 1);
		expect(anchors.unitAt(inner as string)).toBeNull();
	});

	it("matches stored machine rows only when their end position agrees", async () => {
		const anchors = await getUnitAnchors(t.db, book.id);
		const [first, second] = anchors.units;
		if (!first || !second) throw new Error("expected units");
		await saveUnitResult(t.db, book.id, machineRow(0, first.endPosition));
		// Written against an older structure: same ordinal, different extent.
		await saveUnitResult(t.db, book.id, machineRow(1, second.endPosition + 1));
		const stored = await t.db
			.select({
				unitOrdinal: unitSummaries.unitOrdinal,
				endPosition: unitSummaries.endPosition,
			})
			.from(unitSummaries)
			.orderBy(unitSummaries.unitOrdinal);
		expect(stored.map((row) => anchors.unitOf(row))).toEqual([first, null]);
		expect(anchors.unitOf({ unitOrdinal: 7, endPosition: 1 })).toBeNull();
	});

	it("derives each edition's units once per cache", async () => {
		const anchorsFor = unitAnchorsCache(t.db);
		const a = anchorsFor(book.id);
		expect(anchorsFor(book.id)).toBe(a);
		expect((await a).units).toEqual(
			(await getUnitAnchors(t.db, book.id)).units,
		);
		expect(unitAnchorsCache(t.db)(book.id)).not.toBe(a);
	});
});
