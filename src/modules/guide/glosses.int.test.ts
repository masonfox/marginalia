import { and, asc, between, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type ObservationKind,
	saveUnitResult,
	type UnitResult,
} from "#/modules/analysis";
import { getReadingUnits, passages, type ReadingUnit } from "#/modules/catalog";
import { type ParsedEdition, parseEpub } from "#/modules/epub";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { ingestBook, tempDataDir } from "../../../test/library";
import {
	createNote,
	excludeGlossName,
	getGlossCard,
	getReadingPosition,
	getSectionGlosses,
	glossesFor,
	includeGlossName,
	saveCorrection,
	setReadingPosition,
} from ".";

let t: TestDb;
let dataDir: string;
let parsed: ParsedEdition;
let units: ReadingUnit[];
let books = 0;

/** A new ready edition of the nested-TOC fixture (three units). */
async function book() {
	const bytes = await fixtures.nestedToc();
	const { id } = await ingestBook(
		t.db,
		dataDir,
		Buffer.concat([bytes, Buffer.from(`${books++}`)]),
		`glosses-${books}.epub`,
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
const through = (i: number) => ({
	kind: "unit" as const,
	endPosition: u(i).endPosition,
});

type Seen = [name: string, note?: string, kind?: ObservationKind];

const result = (i: number, seen: Seen[]): UnitResult => ({
	unitOrdinal: i,
	unitLabel: u(i).label,
	endPosition: u(i).endPosition,
	summary: `Summary ${i}`,
	summaryCitations: [],
	observations: seen.map(([name, note, kind = "character"]) => ({
		name,
		kind,
		note: note ?? `${name} in ${i}`,
		citations: [],
	})),
	model: "m",
});

async function preprocessed(seen: Seen[][]) {
	const id = await book();
	for (const [i, names] of seen.entries()) {
		await saveUnitResult(t.db, id, result(i, names));
	}
	return id;
}

/** Unit `i`'s anchor in edition `id`: locators differ per edition. */
async function startOf(id: string, i: number) {
	const unit = (await getReadingUnits(t.db, id))[i];
	if (!unit) throw new Error(`no unit ${i}`);
	return unit.startLocator;
}

/** The passages of unit `i` in edition `id`, in reading order. */
async function unitPassages(id: string, i: number) {
	return t.db
		.select({
			locator: passages.locator,
			text: passages.text,
			revealPosition: passages.revealPosition,
		})
		.from(passages)
		.where(
			and(
				eq(passages.editionId, id),
				between(passages.position, u(i).startPosition, u(i).endPosition),
			),
		)
		.orderBy(asc(passages.position));
}

/** A passage inside unit `i`, before its end: the unit has not ended there. */
async function middleOf(id: string, i: number) {
	const [first] = await unitPassages(id, i);
	if (!first) throw new Error(`no passage in unit ${i}`);
	expect(first.revealPosition).toBeLessThan(u(i).endPosition);
	expect(first.revealPosition).toBeGreaterThan(u(i - 1).endPosition);
	return first;
}

/** The marked mentions of `text` shown at `passage`'s position. */
async function marked(
	id: string,
	passage: { locator: string; revealPosition: number },
	text: string,
) {
	const { glosses } = await glossesFor(t.db, id, [{ ...passage, text }]);
	return glosses.map((g) => [text.slice(g.start, g.end), g.subjectRef]);
}

async function card(id: string, ref: string, locator: string) {
	const found = await getGlossCard(t.db, id, ref, locator);
	if (!found) throw new Error("expected a card");
	return found;
}

describe("gloss bound", () => {
	it("uses a passage's own position after a jump ahead, and excludes its unit", async () => {
		const id = await preprocessed([
			[["Brawne Lamia"]],
			[["Brawne Lamia"], ["Kassad"]],
			[["Brawne Lamia"], ["Sol"]],
		]);
		// The reader is in the first unit, and jumps to the middle of the third.
		await setReadingPosition(t.db, id, through(0));
		const mid = await middleOf(id, 2);

		expect(await marked(id, mid, "Kassad, Sol and Brawne Lamia met.")).toEqual([
			["Kassad", "k:kassad"],
			["Brawne Lamia", "k:brawne lamia"],
		]);
		const shown = await card(id, "k:brawne lamia", mid.locator);
		expect(shown).toMatchObject({
			name: "Brawne Lamia",
			kind: "character",
			asOfLabel: u(1).label,
			observationCount: 2,
		});
		// Newest first, and nothing from the unit the passage is in.
		expect(shown.observations.map((o) => o.unitLabel)).toEqual([
			u(1).label,
			u(0).label,
		]);
		expect(await getGlossCard(t.db, id, "k:sol", mid.locator)).toBeNull();
		// Opening the passage leaves the reading position where it was.
		expect(await getReadingPosition(t.db, id)).toMatchObject({
			kind: "unit",
			maxPosition: u(0).endPosition,
		});
	});

	it("marks nothing in the first unit", async () => {
		const id = await preprocessed([[["Alpha"]], [["Beta"]], []]);
		const [first] = await unitPassages(id, 0);
		if (!first) throw new Error("no passages");
		const { glosses } = await glossesFor(t.db, id, [
			{ ...first, text: "Alpha and Beta." },
		]);
		expect(glosses).toEqual([]);
		expect(await getGlossCard(t.db, id, "k:alpha", first.locator)).toBeNull();
	});

	it("matches the displayed range against the largest position once, each passage at its own", async () => {
		const id = await preprocessed([[["Alpha"]], [["Beta"]], []]);
		const mid1 = await middleOf(id, 1);
		const mid2 = await middleOf(id, 2);
		const { glosses } = await glossesFor(t.db, id, [
			{ ...mid1, text: "Beta, then Alpha." },
			{ ...mid2, text: "Beta again." },
		]);
		expect(glosses.map((g) => [g.locator, g.subjectRef])).toEqual([
			[mid1.locator, "k:alpha"],
			[mid2.locator, "k:beta"],
		]);
	});
});

describe("gloss card", () => {
	it("shows the three most recent merged observations and the visible attached notes", async () => {
		const id = await preprocessed([
			[
				["Brawne Lamia", "Arrives."],
				["Brawne Lamia", "Is a detective."],
			],
			[
				["Brawne Lamia", "Machine text."],
				["Kassad", "Hidden."],
			],
			[["Brawne Lamia", "Later."]],
		]);
		await saveCorrection(t.db, id, {
			target: "observation",
			unitLocator: await startOf(id, 1),
			nameKey: "brawne lamia",
			action: "replace",
			text: "Reader text.",
		});
		await saveCorrection(t.db, id, {
			target: "observation",
			unitLocator: await startOf(id, 1),
			nameKey: "kassad",
			action: "suppress",
		});
		const early = await createNote(t.db, id, {
			title: "Theory",
			body: "She knows.",
			anchor: through(0),
			attachment: { kind: "subject", ref: "k:brawne lamia" },
		});
		const late = await createNote(t.db, id, {
			title: "After the reveal",
			body: "Spoiler.",
			anchor: through(2),
			attachment: { kind: "subject", ref: "k:brawne lamia" },
		});
		expect(early.ok && late.ok).toBe(true);

		const mid = await middleOf(id, 2);
		const shown = await card(id, "k:brawne lamia", mid.locator);
		expect(shown.observationCount).toBe(3);
		const [newest, ...earlier] = shown.observations;
		expect(newest).toEqual({
			unitLabel: u(1).label,
			observedAs: null,
			note: "Reader text.",
			corrected: true,
		});
		// Both from the first unit: within a unit, rows have no order of their own.
		expect(
			earlier.map((o) => [o.unitLabel, o.note, o.corrected]).sort(),
		).toEqual([
			[u(0).label, "Arrives.", false],
			[u(0).label, "Is a detective.", false],
		]);
		expect(shown.notes.map((n) => n.title)).toEqual(["Theory"]);

		// Suppressed rows are omitted: Kassad has nothing left to gloss.
		expect(await marked(id, mid, "Kassad and Brawne Lamia.")).toEqual([
			["Brawne Lamia", "k:brawne lamia"],
		]);
		expect(await getGlossCard(t.db, id, "k:kassad", mid.locator)).toBeNull();

		// At the end of the book, the most recent three include the last unit.
		const [last] = (await unitPassages(id, 2)).slice(-1);
		if (!last) throw new Error("no passage");
		const end = await card(id, "k:brawne lamia", last.locator);
		expect(end.observations.map((o) => o.unitLabel)).toEqual([
			u(2).label,
			u(1).label,
			u(0).label,
		]);
		expect(end.observations.slice(0, 2).map((o) => o.note)).toEqual([
			"Later.",
			"Reader text.",
		]);
		expect(end.observationCount).toBe(4);
		expect(end.notes.map((n) => n.title).sort()).toEqual([
			"After the reveal",
			"Theory",
		]);
	});

	it("is null for a passage of another edition", async () => {
		const id = await preprocessed([[["Alpha"]], [], []]);
		const other = await preprocessed([[["Alpha"]], [], []]);
		const mid = await middleOf(id, 1);
		expect(await getGlossCard(t.db, other, "k:alpha", mid.locator)).toBeNull();
		expect((await card(id, "k:alpha", mid.locator)).name).toBe("Alpha");
	});
});

describe("gloss exclusions", () => {
	it("stops a name from being glossed anywhere in the book, until it is glossed again", async () => {
		const id = await preprocessed([[["Will"], ["Hope"]], [], []]);
		const other = await preprocessed([[["Will"]], [], []]);
		const mid = await middleOf(id, 1);
		const otherMid = await middleOf(other, 1);
		const text = "Will and Hope.";

		expect(await excludeGlossName(t.db, id, "Will")).toBe(true);
		expect(await excludeGlossName(t.db, id, "will")).toBe(true);
		expect(await marked(id, mid, text)).toEqual([["Hope", "k:hope"]]);
		expect(await marked(id, await middleOf(id, 2), text)).toEqual([
			["Hope", "k:hope"],
		]);
		// Other books are unaffected.
		expect(await marked(other, otherMid, text)).toEqual([["Will", "k:will"]]);

		expect(await includeGlossName(t.db, id, "will")).toBe(true);
		expect(await includeGlossName(t.db, id, "will")).toBe(false);
		expect(await marked(id, mid, text)).toEqual([
			["Will", "k:will"],
			["Hope", "k:hope"],
		]);
	});

	it("is refused for a missing book or an empty name", async () => {
		expect(
			await excludeGlossName(
				t.db,
				"00000000-0000-4000-8000-000000000000",
				"Will",
			),
		).toBe(false);
		expect(await excludeGlossName(t.db, await book(), " - ")).toBe(false);
	});
});

describe("section glosses", () => {
	it("glosses the section's own passages and lists the excluded names seen there", async () => {
		// The fixture's Chapter 3 reads "Gamma.", and its Chapter 1 "Alpha.".
		const id = await preprocessed([[["Gamma"], ["Alpha"]], [["Delta"]], []]);
		const gamma = (await unitPassages(id, 2)).find((p) => p.text === "Gamma.");
		if (!gamma) throw new Error("no Gamma passage");
		const section = await getSectionGlosses(t.db, gamma.locator);
		expect(
			section.glosses.map((g) => [g.subjectRef, g.nameKey, g.end - g.start]),
		).toEqual([["k:gamma", "gamma", 5]]);
		expect(section.excluded).toEqual([]);

		await excludeGlossName(t.db, id, "Gamma");
		await excludeGlossName(t.db, id, "Delta");
		// Delta is listed by its name once observed within the section; an
		// excluded name first observed later would not be.
		expect(await getSectionGlosses(t.db, gamma.locator)).toEqual({
			glosses: [],
			excluded: [
				{ nameKey: "delta", name: "Delta" },
				{ nameKey: "gamma", name: "Gamma" },
			],
		});
	});

	it("is empty for an unknown locator", async () => {
		expect(await getSectionGlosses(t.db, "nope")).toEqual({
			glosses: [],
			excluded: [],
		});
	});
});
