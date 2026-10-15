import { and, asc, between, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type ObservationKind,
	saveUnitResult,
	type UnitResult,
	unitObservations,
	unitSummaries,
} from "#/modules/analysis";
import { getReadingUnits, passages, type ReadingUnit } from "#/modules/catalog";
import { type ParsedEdition, parseEpub } from "#/modules/epub";
import { deleteEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { ingestBook, silentLog, tempDataDir } from "../../../test/library";
import {
	fingerprintOf,
	getCorrectionReview,
	getGuideChapters,
	getGuideSubject,
	getMergedObservations,
	getMergedSummaries,
	getUnitAnchors,
	guideCorrections,
	keepCorrection,
	listSubjects,
	observationText,
	removeCorrection,
	saveCorrection,
} from ".";

let t: TestDb;
let dataDir: string;
let parsed: ParsedEdition;
let units: ReadingUnit[];
let names = 0;

/** A new ready edition of the nested-TOC fixture (three units). */
async function book() {
	const bytes = await fixtures.nestedToc();
	const { id } = await ingestBook(
		t.db,
		dataDir,
		Buffer.concat([bytes, Buffer.from(`${names++}`)]),
		`guide-corrections-${names}.epub`,
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

type Seen = [name: string, note?: string, kind?: ObservationKind];

/** A unit result for unit `i`, with an observation per name. */
const result = (i: number, seen: Seen[] = [], summary = `Summary ${i}`) =>
	({
		unitOrdinal: i,
		unitLabel: u(i).label,
		endPosition: u(i).endPosition,
		summary,
		summaryCitations: [
			{ locator: u(i).startLocator, quote: `quote ${i}`, verified: true },
		],
		observations: seen.map(([name, note = `${name} in ${i}`, kind]) => ({
			name,
			kind: kind ?? "character",
			note,
			citations: [],
		})),
		model: "m",
	}) satisfies UnitResult;

async function preprocessed(seen: Seen[][]) {
	const id = await book();
	for (const [i, names] of seen.entries()) {
		await saveUnitResult(t.db, id, result(i, names));
	}
	return id;
}

/** The unit's passages in reading order, with their text. */
async function unitPassages(id: string, i: number) {
	return t.db
		.select({ locator: passages.locator, text: passages.text })
		.from(passages)
		.where(
			and(
				eq(passages.editionId, id),
				between(passages.position, u(i).startPosition, u(i).endPosition),
			),
		)
		.orderBy(asc(passages.position));
}

/** A quote of unit `i`: its last passage, a paragraph, quoted whole. */
async function quotable(id: string, i: number) {
	const found = (await unitPassages(id, i)).at(-1);
	if (!found) throw new Error(`no passage in unit ${i}`);
	return { locator: found.locator, quote: found.text };
}

/** Unit `i`'s anchor in edition `id`: locators differ per edition. */
async function at(id: string, i: number) {
	const unit = (await getReadingUnits(t.db, id))[i];
	if (!unit) throw new Error(`no unit ${i}`);
	return unit.startLocator;
}

const whole = { kind: "whole" } as const;
const through = (i: number) => ({
	kind: "unit" as const,
	endPosition: u(i).endPosition,
});

const summaries = async (id: string, bound: number | null = null) =>
	getMergedSummaries(t.db, id, bound, await getUnitAnchors(t.db, id));
const observations = async (id: string, bound: number | null = null) =>
	getMergedObservations(t.db, id, bound, await getUnitAnchors(t.db, id));

const replaceSummary = async (
	id: string,
	i: number,
	text: string,
	citation?: { locator: string; quote: string } | null,
) =>
	saveCorrection(t.db, id, {
		target: "summary",
		unitLocator: await at(id, i),
		action: "replace",
		text,
		citation,
	});

describe("correction mutations", () => {
	it("replaces a summary with the reader's text and verified citation, leaving machine rows alone", async () => {
		const id = await preprocessed([[], [], []]);
		const cite = await quotable(id, 1);
		const saved = await replaceSummary(id, 1, "  What really happens.  ", cite);
		expect(saved).toMatchObject({
			ok: true,
			citation: { locator: cite.locator, quote: cite.quote, verified: true },
		});
		const merged = await summaries(id);
		expect(merged.map((s) => s.summary)).toEqual([
			"Summary 0",
			"What really happens.",
			"Summary 2",
		]);
		expect(merged[1]?.citations).toEqual([
			{ locator: cite.locator, quote: cite.quote, verified: true },
		]);
		expect(merged[1]?.correction).toMatchObject({
			action: "replace",
			regeneratedSince: false,
			generated: "Summary 1",
		});
		expect(merged[0]?.correction).toBeNull();
		// The machine row is unchanged.
		const [machine] = await t.db
			.select({ summary: unitSummaries.summary })
			.from(unitSummaries)
			.where(
				and(eq(unitSummaries.editionId, id), eq(unitSummaries.unitOrdinal, 1)),
			);
		expect(machine?.summary).toBe("Summary 1");
		// Stored once per item: saving again overwrites it.
		const again = await replaceSummary(id, 1, "Second thoughts.");
		expect(again.ok && saved.ok && again.id === saved.id).toBe(true);
		expect((await summaries(id))[1]).toMatchObject({
			summary: "Second thoughts.",
			citations: [],
		});
	});

	it("rejects a citation from outside the corrected unit", async () => {
		const id = await preprocessed([[], [], []]);
		const elsewhere = await quotable(id, 2);
		expect(await replaceSummary(id, 0, "Mine.", elsewhere)).toEqual({
			ok: false,
			reason: "citation_outside_unit",
		});
		// Nor one from another book, or a locator that is not a passage.
		const other = await preprocessed([[], [], []]);
		expect(
			await replaceSummary(id, 0, "Mine.", await quotable(other, 0)),
		).toEqual({ ok: false, reason: "citation_outside_unit" });
		expect(
			await replaceSummary(id, 0, "Mine.", { locator: "nope", quote: "x" }),
		).toEqual({ ok: false, reason: "citation_outside_unit" });
		expect(await summaries(id)).toSatisfy((rows: { correction: unknown }[]) =>
			rows.every((r) => r.correction === null),
		);
	});

	it("stores a quote not found in the cited passage as unverified", async () => {
		const id = await preprocessed([[], [], []]);
		const { locator } = await quotable(id, 0);
		const saved = await replaceSummary(id, 0, "Mine.", {
			locator,
			quote: "words the book never says",
		});
		expect(saved).toMatchObject({
			ok: true,
			citation: { locator, verified: false },
		});
		expect((await summaries(id))[0]?.citations).toEqual([
			{ locator, quote: "words the book never says", verified: false },
		]);
	});

	it("suppresses an observation everywhere the Guide reads it, and lists it behind show hidden", async () => {
		const id = await preprocessed([[["Lamia"]], [["Lamia"], ["Anna"]], []]);
		const saved = await saveCorrection(t.db, id, {
			target: "observation",
			unitLocator: await at(id, 1),
			nameKey: "lamia",
			action: "suppress",
		});
		expect(saved.ok).toBe(true);
		expect(
			(await observations(id)).map((o) => [o.unitOrdinal, o.name]),
		).toEqual([
			[0, "Lamia"],
			[1, "Anna"],
		]);
		const anchors = await getUnitAnchors(t.db, id);
		const lamia = (await listSubjects(t.db, id, null, anchors)).find(
			(s) => s.ref === "k:lamia",
		);
		expect(lamia?.unitCount).toBe(1);
		const timeline = await getGuideSubject(t.db, id, whole, "k:lamia");
		const entries = timeline.ok ? (timeline.subject?.entries ?? []) : [];
		expect(
			entries.map((e) => [e.unitOrdinal, e.correction?.action ?? null]),
		).toEqual([
			[0, null],
			[1, "suppress"],
		]);
		// Suppressed in its only unit, a subject leaves the Index unless hidden ones are shown.
		await saveCorrection(t.db, id, {
			target: "observation",
			unitLocator: await at(id, 1),
			nameKey: "anna",
			action: "suppress",
		});
		expect(
			(await listSubjects(t.db, id, null, anchors)).map((s) => s.ref),
		).toEqual(["k:lamia"]);
		const withHidden = await listSubjects(t.db, id, null, anchors, {
			includeHidden: true,
		});
		expect(withHidden.map((s) => [s.ref, s.hidden])).toEqual([
			["k:anna", true],
			["k:lamia", false],
		]);
	});

	it("replaces every observation of a name in the unit with one corrected row", async () => {
		const id = await preprocessed([
			[
				["Lamia", "A poet."],
				["Lamia", "A detective."],
				["Anna", "Waits."],
			],
		]);
		const saved = await saveCorrection(t.db, id, {
			target: "observation",
			unitLocator: await at(id, 0),
			nameKey: "lamia",
			action: "replace",
			text: "A detective, not a poet.",
		});
		expect(saved.ok).toBe(true);
		const rows = await observations(id);
		expect(rows.map((o) => [o.name, o.note])).toEqual(
			expect.arrayContaining([
				["Lamia", "A detective, not a poet."],
				["Anna", "Waits."],
			]),
		);
		expect(rows).toHaveLength(2);
		const [stored] = await t.db
			.select({ fingerprint: guideCorrections.fingerprint })
			.from(guideCorrections)
			.where(eq(guideCorrections.editionId, id));
		// The machine text is the unit's notes for the name, sorted and joined.
		expect(stored?.fingerprint).toBe(
			fingerprintOf(observationText(["A poet.", "A detective."])),
		);
		const machine = await t.db
			.select({ note: unitObservations.note })
			.from(unitObservations)
			.where(eq(unitObservations.editionId, id));
		expect(machine.map((m) => m.note).sort()).toEqual([
			"A detective.",
			"A poet.",
			"Waits.",
		]);
	});

	it("removes a correction, restoring the generated row", async () => {
		const id = await preprocessed([[], [], []]);
		const saved = await replaceSummary(id, 0, "Mine.");
		if (!saved.ok) throw new Error("expected a correction");
		expect(await removeCorrection(t.db, id, saved.id)).toBe(true);
		expect((await summaries(id))[0]).toMatchObject({
			summary: "Summary 0",
			citations: [{ quote: "quote 0" }],
			correction: null,
		});
		expect(await removeCorrection(t.db, id, saved.id)).toBe(false);
	});

	it("refuses a unit that starts nothing, a row that isn't current, and empty text", async () => {
		const id = await preprocessed([[["Anna"]], []]);
		const [, second] = await unitPassages(id, 0);
		if (!second) throw new Error("expected two passages");
		expect(
			await saveCorrection(t.db, id, {
				target: "summary",
				unitLocator: second.locator,
				action: "suppress",
			}),
		).toEqual({ ok: false, reason: "not_found" });
		// Unit 2 has no summary; nobody named Lamia is observed in unit 0.
		expect(await replaceSummary(id, 2, "Mine.")).toEqual({
			ok: false,
			reason: "not_current",
		});
		expect(
			await saveCorrection(t.db, id, {
				target: "observation",
				unitLocator: await at(id, 0),
				nameKey: "lamia",
				action: "suppress",
			}),
		).toEqual({ ok: false, reason: "not_current" });
		expect(await replaceSummary(id, 0, "   ")).toEqual({
			ok: false,
			reason: "invalid",
		});
		expect(
			await t.db
				.select()
				.from(guideCorrections)
				.where(eq(guideCorrections.editionId, id)),
		).toEqual([]);
	});
});

describe("merged view with corrections", () => {
	it("is bounded like the row it corrects", async () => {
		const id = await preprocessed([[["Anna"]], [], [["Anna"]]]);
		expect((await replaceSummary(id, 2, "Late spoiler.")).ok).toBe(true);
		const anna = await saveCorrection(t.db, id, {
			target: "observation",
			unitLocator: await at(id, 2),
			nameKey: "anna",
			action: "replace",
			text: "Late identity.",
		});
		expect(anna.ok).toBe(true);
		const early = await summaries(id, u(0).endPosition);
		expect(early.map((s) => s.summary)).toEqual(["Summary 0"]);
		expect(
			(await observations(id, u(1).endPosition)).map((o) => o.note),
		).toEqual(["Anna in 0"]);
		const chapters = await getGuideChapters(t.db, id, through(1));
		expect(JSON.stringify(chapters)).not.toContain("Late");
		const review = await getCorrectionReview(t.db, id, through(1));
		expect(review.ok && review.review).toEqual({
			regenerated: [],
			detached: [],
		});
		// Through the corrected unit, both apply.
		expect((await summaries(id)).at(-1)?.summary).toBe("Late spoiler.");
		expect((await observations(id)).at(-1)?.note).toBe("Late identity.");
	});

	it("has no effect while the machine row isn't current, and reapplies after regeneration", async () => {
		const id = await preprocessed([[["Anna"]], [], []]);
		expect((await replaceSummary(id, 0, "Mine.")).ok).toBe(true);
		expect(
			(
				await saveCorrection(t.db, id, {
					target: "observation",
					unitLocator: await at(id, 0),
					nameKey: "anna",
					action: "suppress",
				})
			).ok,
		).toBe(true);
		// An older prompt version's rows are not current.
		for (const table of [unitSummaries, unitObservations]) {
			await t.db
				.update(table)
				.set({ promptVersion: 1 })
				.where(and(eq(table.editionId, id), eq(table.unitOrdinal, 0)));
		}
		expect((await summaries(id)).map((s) => s.unitOrdinal)).toEqual([1, 2]);
		const chapters = await getGuideChapters(t.db, id, whole);
		expect(chapters.ok && chapters.chapters[0]?.summary).toBeNull();
		// Regenerated under the current prompt, with different text.
		await saveUnitResult(
			t.db,
			id,
			result(0, [["Anna", "Waits again."]], "Regenerated 0"),
		);
		const [first] = await summaries(id);
		expect(first).toMatchObject({
			summary: "Mine.",
			citations: [],
			correction: {
				action: "replace",
				regeneratedSince: true,
				generated: "Regenerated 0",
			},
		});
		expect((await observations(id)).map((o) => o.name)).toEqual([]);
		// Stale rows are not current either.
		await t.db
			.update(unitSummaries)
			.set({ stale: true })
			.where(eq(unitSummaries.editionId, id));
		expect(await summaries(id)).toEqual([]);
	});

	it("flags a correction regenerated since, and keep clears the flag", async () => {
		const id = await preprocessed([[["Anna"]], [], []]);
		const saved = await replaceSummary(id, 0, "Mine.");
		if (!saved.ok) throw new Error("expected a correction");
		const observed = await saveCorrection(t.db, id, {
			target: "observation",
			unitLocator: await at(id, 0),
			nameKey: "anna",
			action: "replace",
			text: "Anna, really.",
		});
		if (!observed.ok) throw new Error("expected a correction");
		// Regenerated with the same text: nothing to review.
		await saveUnitResult(t.db, id, result(0, [["Anna"]]));
		expect((await summaries(id))[0]?.correction?.regeneratedSince).toBe(false);
		await saveUnitResult(
			t.db,
			id,
			result(0, [["Anna", "Leaves."]], "Regenerated 0"),
		);
		const review = await getCorrectionReview(t.db, id, whole);
		expect(review.ok && review.review.regenerated).toEqual([
			{
				id: saved.id,
				target: "summary",
				action: "replace",
				unitLabel: u(0).label,
				unitLocator: await at(id, 0),
				name: null,
				nameKey: null,
				text: "Mine.",
				generated: "Regenerated 0",
			},
			{
				id: observed.id,
				target: "observation",
				action: "replace",
				unitLabel: u(0).label,
				unitLocator: await at(id, 0),
				name: "Anna",
				nameKey: "anna",
				text: "Anna, really.",
				generated: "Leaves.",
			},
		]);
		expect(await keepCorrection(t.db, id, saved.id)).toMatchObject({
			ok: true,
		});
		expect((await summaries(id))[0]).toMatchObject({
			summary: "Mine.",
			correction: { regeneratedSince: false },
		});
		expect((await keepCorrection(t.db, id, observed.id)).ok).toBe(true);
		const after = await getCorrectionReview(t.db, id, whole);
		expect(after.ok && after.review.regenerated).toEqual([]);
		// Nothing to keep against while the row isn't current.
		await t.db
			.update(unitSummaries)
			.set({ stale: true })
			.where(eq(unitSummaries.editionId, id));
		expect(await keepCorrection(t.db, id, saved.id)).toEqual({
			ok: false,
			reason: "not_current",
		});
		expect(await keepCorrection(t.db, id, 2147483647)).toEqual({
			ok: false,
			reason: "not_found",
		});
	});

	it("shows corrected summaries and hidden ones in Chapters", async () => {
		const id = await preprocessed([[], [], []]);
		await replaceSummary(id, 0, "Mine.");
		await saveCorrection(t.db, id, {
			target: "summary",
			unitLocator: await at(id, 1),
			action: "suppress",
		});
		const chapters = await getGuideChapters(t.db, id, whole);
		expect(
			chapters.ok &&
				chapters.chapters.map((c) => [
					c.summary?.text,
					c.summary?.correction?.action ?? null,
				]),
		).toEqual([
			["Mine.", "replace"],
			["Summary 1", "suppress"],
			["Summary 2", null],
		]);
	});
});

describe("edition deletion", () => {
	it("deletes the edition's corrections", async () => {
		const id = await preprocessed([[], [], []]);
		expect((await replaceSummary(id, 0, "Mine.")).ok).toBe(true);
		await deleteEdition(t.db, dataDir, id, silentLog);
		expect(
			await t.db
				.select()
				.from(guideCorrections)
				.where(eq(guideCorrections.editionId, id)),
		).toEqual([]);
	});
});
