import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type ObservationKind,
	saveUnitResult,
	type UnitResult,
	unitObservations,
	unitSummaries,
} from "#/modules/analysis";
import { getReadingUnits, type ReadingUnit } from "#/modules/catalog";
import { type ParsedEdition, parseEpub } from "#/modules/epub";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { ingestBook, tempDataDir } from "../../../test/library";
import {
	getGuideChapters,
	getGuideProvenance,
	getGuideSubject,
	getMergedObservations,
	getMergedSummaries,
	getSubjectTimeline,
	getUnitAnchors,
	listGuideSubjects,
	listSubjects,
} from ".";

let t: TestDb;
let dataDir: string;
let parsed: ParsedEdition;
let units: ReadingUnit[];
let names = 0;

/** A new ready edition of the nested-TOC fixture (three units). */
async function book() {
	const bytes = await fixtures.nestedToc();
	// Distinct bytes make a distinct edition; the content is parsed once.
	const { id } = await ingestBook(
		t.db,
		dataDir,
		Buffer.concat([bytes, Buffer.from(`${names++}`)]),
		`guide-view-${names}.epub`,
		{ parse: async () => parsed },
	);
	return id;
}

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	parsed = await parseEpub(await fixtures.nestedToc());
	units = await getReadingUnits(t.db, await book());
	expect(units).toHaveLength(3);
});

const u = (i: number) => units[i] as ReadingUnit;

type Seen = [name: string, kind?: ObservationKind];

/** A unit result for unit `i`, with an observation per name. */
const result = (i: number, seen: Seen[] = [], model = "m"): UnitResult => ({
	unitOrdinal: i,
	unitLabel: u(i).label,
	endPosition: u(i).endPosition,
	summary: `Summary ${i}`,
	summaryCitations: [
		{ locator: u(i).startLocator, quote: `quote ${i}`, verified: i !== 1 },
	],
	observations: seen.map(([name, kind = "character"]) => ({
		name,
		kind,
		note: `${name} in ${i}`,
		citations: [],
	})),
	model,
});

async function preprocessed(seen: Seen[][]) {
	const id = await book();
	for (const [i, names] of seen.entries()) {
		await saveUnitResult(t.db, id, result(i, names));
	}
	return id;
}

const whole = { kind: "whole" } as const;
const through = (i: number) => ({
	kind: "unit" as const,
	endPosition: u(i).endPosition,
});

describe("merged view", () => {
	it("hides a unit when the bound falls inside it", async () => {
		const id = await preprocessed([[["Anna"]], [["Anna"]], [["Anna"]]]);
		const anchors = await getUnitAnchors(t.db, id);
		const inside = u(1).endPosition - 1;
		expect(inside).toBeGreaterThan(u(0).endPosition);
		const summaries = await getMergedSummaries(t.db, id, inside, anchors);
		expect(summaries.map((s) => s.unitOrdinal)).toEqual([0]);
		expect(summaries[0]).toMatchObject({
			unitLabel: u(0).label,
			unitLocator: anchors.locatorOf(0),
			summary: "Summary 0",
			model: "m",
		});
		const observations = await getMergedObservations(t.db, id, inside, anchors);
		expect(observations.map((o) => o.unitOrdinal)).toEqual([0]);
		// At the unit's end it is included; the whole book has everything.
		const atEnd = await getMergedSummaries(t.db, id, u(1).endPosition, anchors);
		expect(atEnd.map((s) => s.unitOrdinal)).toEqual([0, 1]);
		const all = await getMergedObservations(t.db, id, null, anchors);
		expect(all.map((o) => o.unitOrdinal)).toEqual([0, 1, 2]);
	});

	it("hides stale rows, rows of an older prompt, and rows of an older structure", async () => {
		const id = await preprocessed([[["Anna"]], [["Anna"]], [["Anna"]]]);
		// Unit 0: marked stale by a reparse.
		for (const table of [unitSummaries, unitObservations]) {
			await t.db
				.update(table)
				.set({ stale: true })
				.where(and(eq(table.editionId, id), eq(table.unitOrdinal, 0)));
		}
		// Unit 1: written under an older prompt version.
		for (const table of [unitSummaries, unitObservations]) {
			await t.db
				.update(table)
				.set({ promptVersion: 1 })
				.where(and(eq(table.editionId, id), eq(table.unitOrdinal, 1)));
		}
		// Unit 2: written against a structure where the unit ended elsewhere.
		await saveUnitResult(t.db, id, {
			...result(2, [["Anna"]]),
			endPosition: u(2).endPosition + 1,
		});
		const anchors = await getUnitAnchors(t.db, id);
		expect(await getMergedSummaries(t.db, id, null, anchors)).toEqual([]);
		expect(await getMergedObservations(t.db, id, null, anchors)).toEqual([]);
		expect(await listSubjects(t.db, id, null, anchors)).toEqual([]);
		const chapters = await getGuideChapters(t.db, id, whole);
		expect(chapters.ok && chapters.chapters.map((c) => c.summary)).toEqual([
			null,
			null,
			null,
		]);
	});
});

describe("Index listing", () => {
	it("lists subjects seen within the bound with kind, unit count and first appearance", async () => {
		const id = await preprocessed([
			[["Anna"], ["Moscow", "place"]],
			[["Anna"], ["anna"], ["Train", "object"]],
			// First seen after the bound.
			[["Vronsky"], ["Anna"], ["Train", "motif"]],
		]);
		const anchors = await getUnitAnchors(t.db, id);
		const subjects = await listSubjects(t.db, id, u(1).endPosition, anchors);
		expect(subjects).toEqual([
			{
				ref: "k:anna",
				name: "Anna",
				kind: "character",
				readerKind: null,
				names: [{ key: "anna", name: "Anna" }],
				unitCount: 2,
				firstPosition: u(0).endPosition,
				firstUnitLabel: u(0).label,
				hidden: false,
			},
			{
				ref: "k:moscow",
				name: "Moscow",
				kind: "place",
				readerKind: null,
				names: [{ key: "moscow", name: "Moscow" }],
				unitCount: 1,
				firstPosition: u(0).endPosition,
				firstUnitLabel: u(0).label,
				hidden: false,
			},
			{
				ref: "k:train",
				name: "Train",
				kind: "object",
				readerKind: null,
				names: [{ key: "train", name: "Train" }],
				unitCount: 1,
				firstPosition: u(1).endPosition,
				firstUnitLabel: u(1).label,
				hidden: false,
			},
		]);
		expect(subjects.map((s) => s.name)).not.toContain("Vronsky");

		const all = await listGuideSubjects(t.db, id, whole);
		if (!all.ok) throw new Error("expected subjects");
		expect(all.subjects.map((s) => [s.name, s.unitCount])).toEqual([
			["Anna", 3],
			["Moscow", 1],
			// Object once, motif once: the earliest kind wins the tie.
			["Train", 2],
			["Vronsky", 1],
		]);
		expect(all.subjects.find((s) => s.name === "Train")?.kind).toBe("object");
	});
});

describe("subject timeline", () => {
	it("returns a subject's observations within the bound in reading order", async () => {
		const id = await preprocessed([
			[["Anna"]],
			[["Vronsky"], ["ANNA"]],
			[["Anna"]],
		]);
		const anchors = await getUnitAnchors(t.db, id);
		const timeline = await getSubjectTimeline(
			t.db,
			id,
			"k:anna",
			null,
			anchors,
		);
		expect(timeline).toMatchObject({ ref: "k:anna", name: "Anna" });
		expect(
			timeline?.entries.map((e) => [e.unitLabel, e.observedAs, e.note]),
		).toEqual([
			[u(0).label, null, "Anna in 0"],
			[u(1).label, "ANNA", "ANNA in 1"],
			[u(2).label, null, "Anna in 2"],
		]);
		expect(timeline?.entries[0]?.unitLocator).toBe(anchors.locatorOf(0));

		const bounded = await getSubjectTimeline(
			t.db,
			id,
			"k:anna",
			u(1).endPosition,
			anchors,
		);
		expect(bounded?.entries.map((e) => e.unitOrdinal)).toEqual([0, 1]);
		// Nothing within the bound, or no such subject: nothing is disclosed.
		expect(
			await getSubjectTimeline(
				t.db,
				id,
				"k:vronsky",
				u(0).endPosition,
				anchors,
			),
		).toBeNull();
		expect(
			await getSubjectTimeline(t.db, id, "k:nobody", null, anchors),
		).toBeNull();
		expect(await getSubjectTimeline(t.db, id, "s:1", null, anchors)).toBeNull();
	});
});

describe("Guide reads", () => {
	it("reject a bound that is not one of the current units", async () => {
		const id = await preprocessed([[["Anna"]]]);
		const bad = { kind: "unit" as const, endPosition: u(1).endPosition - 1 };
		const stale = { ok: false, reason: "stale_bound" };
		expect(await getGuideChapters(t.db, id, bad)).toEqual(stale);
		expect(await listGuideSubjects(t.db, id, bad)).toEqual(stale);
		expect(await getGuideSubject(t.db, id, bad, "k:anna")).toEqual(stale);
		expect(await getGuideProvenance(t.db, id, bad)).toEqual(stale);
		const missing = "00000000-0000-4000-8000-000000000000";
		expect(await getGuideChapters(t.db, missing, whole)).toEqual({
			ok: false,
			reason: "not_found",
		});
		const subject = await getGuideSubject(t.db, id, through(1), "k:anna");
		expect(subject.ok && subject.subject?.entries).toHaveLength(1);
	});

	it("list every unit within the bound, marking units not yet summarized", async () => {
		const id = await book();
		await saveUnitResult(t.db, id, result(0));
		await saveUnitResult(t.db, id, result(2));
		const anchors = await getUnitAnchors(t.db, id);
		const chapters = await getGuideChapters(t.db, id, through(1));
		if (!chapters.ok) throw new Error("expected chapters");
		expect(chapters.chapters).toEqual([
			{
				ordinal: 0,
				label: u(0).label,
				locator: anchors.locatorOf(0),
				endPosition: u(0).endPosition,
				summary: {
					text: "Summary 0",
					citations: [
						{ locator: u(0).startLocator, quote: "quote 0", verified: true },
					],
					correction: null,
				},
			},
			{
				ordinal: 1,
				label: u(1).label,
				locator: anchors.locatorOf(1),
				endPosition: u(1).endPosition,
				summary: null,
			},
		]);
	});

	it("report the model, prompt version and preprocessing state", async () => {
		const id = await book();
		await saveUnitResult(t.db, id, result(0, [], "model-a"));
		await saveUnitResult(t.db, id, result(1, [], "model-b"));
		const partial = await getGuideProvenance(t.db, id, through(0));
		expect(partial).toEqual({
			ok: true,
			provenance: {
				models: ["model-a"],
				promptVersions: [2],
				state: "partial",
			},
		});
		await saveUnitResult(t.db, id, result(2, [], "model-a"));
		const current = await getGuideProvenance(t.db, id, whole);
		expect(current.ok && current.provenance).toEqual({
			models: ["model-a", "model-b"],
			promptVersions: [2],
			state: "current",
		});
		await t.db
			.update(unitSummaries)
			.set({ stale: true })
			.where(
				and(eq(unitSummaries.editionId, id), eq(unitSummaries.unitOrdinal, 2)),
			);
		const stale = await getGuideProvenance(t.db, id, whole);
		expect(stale.ok && stale.provenance.state).toBe("stale");
	});
});
