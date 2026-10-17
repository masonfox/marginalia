import { beforeAll, describe, expect, it } from "vitest";
import { markDerivedStale, saveUnitResult } from "#/modules/analysis";
import {
	getReadingUnits,
	ingestEdition,
	type ReadingUnit,
} from "#/modules/catalog";
import { parseEpub } from "#/modules/epub";
import {
	createNote,
	listNotes,
	mergeSubjects,
	renameSubject,
	saveCorrection,
} from "#/modules/guide";
import { createRetrieval } from "#/modules/retrieval";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { fixtures } from "../../../test/fixtures";
import {
	ingestBook,
	reshape,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import {
	type ConversationBook,
	getOutline,
	LIMITS,
	readPassage,
	searchBooks,
	type ToolDeps,
} from ".";
import { loadBookMaps } from "./guide-context";
import { buildBookMapMessage } from "./prompt";
import {
	lookupNotes,
	lookupObservations,
	NOTES_ATTRIBUTION,
	readSection,
} from "./tools";

let t: TestDb;
let dataDir: string;
let deps: ToolDeps;
let alpha: ConversationBook;
let beta: ConversationBook;
let outsider: { id: string; shortId: string };

const book = (
	e: { id: string; shortId: string },
	title: string,
	ordinal: number,
	maxPosition: number | null = null,
): ConversationBook => ({
	editionId: e.id,
	shortId: e.shortId,
	title,
	authors: [],
	ordinal,
	maxPosition,
	scopeLabel: maxPosition === null ? null : `Position ${maxPosition}`,
});

const chapters = (word: string, count: number) =>
	Array.from({ length: 3 }, (_, c) => ({
		href: `c${c + 1}.xhtml`,
		title: `Chapter ${c + 1}`,
		body: Array.from(
			{ length: count },
			(_, k) => `<p>The ${word} appears in paragraph ${c * count + k + 1}.</p>`,
		).join(""),
	}));

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	const a = await ingestBook(
		t.db,
		dataDir,
		await buildEpub({
			title: "Alpha",
			language: "en",
			chapters: chapters("lantern", 20),
		}),
		"alpha.epub",
	);
	const b = await ingestBook(
		t.db,
		dataDir,
		await buildEpub({
			title: "Beta",
			language: "en",
			chapters: chapters("lantern", 20),
		}),
		"beta.epub",
	);
	outsider = await ingestBook(
		t.db,
		dataDir,
		await buildEpub({
			title: "Outsider",
			language: "en",
			chapters: [{ href: "o.xhtml", body: "<p>A secret lantern.</p>" }],
		}),
		"outsider.epub",
	);
	alpha = book(a, "Alpha", 0, 2);
	beta = book(b, "Beta", 1, 7);
	deps = {
		db: t.db,
		retrieval: createRetrieval(t.db),
		books: [alpha, beta],
	};
});

describe("searchBooks", () => {
	it("searches only the conversation's books with each book's own bound", async () => {
		const r = await searchBooks(deps, { query: "lantern", limit: 10 });
		if (r.status !== "ok") throw new Error("expected ok");
		const titles = new Set(r.results.map((x) => x.bookTitle));
		expect(titles).toEqual(new Set(["Alpha", "Beta"]));
		expect(titles).not.toContain("Outsider");
		for (const x of r.results) {
			const bound = x.book === "b1" ? 2 : 7;
			expect(x.position).toBeLessThanOrEqual(bound);
		}
	});

	it("restricts to a single book by handle", async () => {
		const r = await searchBooks(deps, { query: "lantern", book: "b2" });
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.results.every((x) => x.book === "b2")).toBe(true);
	});

	it("rejects an unknown book and lists the valid ones", async () => {
		expect(await searchBooks(deps, { query: "lantern", book: "b9" })).toEqual({
			status: "unknown_book",
			message: 'No book "b9" in this conversation.',
			books: [
				{ book: "b1", title: "Alpha" },
				{ book: "b2", title: "Beta" },
			],
		});
	});

	it("caps the result count and snippet length", async () => {
		const unbounded = { ...deps, books: [{ ...alpha, maxPosition: null }] };
		const r = await searchBooks(unbounded, { query: "lantern", limit: 500 });
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.count).toBeLessThanOrEqual(LIMITS.searchResults);
		expect(r.results.every((x) => x.text.length <= LIMITS.snippetChars)).toBe(
			true,
		);
		const dflt = await searchBooks(unbounded, { query: "lantern" });
		if (dflt.status !== "ok") throw new Error("expected ok");
		expect(dflt.count).toBe(LIMITS.defaultSearchResults);
	});
});

describe("preprocessed conversation guidance", () => {
	let units: ReadingUnit[];
	/** The end position of Alpha's unit `i`. */
	const end = (i: number) => (units[i] as ReadingUnit).endPosition;
	/** Alpha's merged map through `bound`, as a reply is sent it. */
	const mapThrough = async (bound: number | null, scopeLabel: string) => {
		const boundedBook = { ...alpha, maxPosition: bound, scopeLabel };
		const { maps } = await loadBookMaps(t.db, [boundedBook]);
		return { book: boundedBook, maps };
	};

	beforeAll(async () => {
		units = await getReadingUnits(t.db, alpha.editionId);
		expect(units).toHaveLength(3);
		for (const unitOrdinal of [0, 1, 2]) {
			await t.db.transaction((tx) =>
				saveUnitResult(tx, alpha.editionId, {
					unitOrdinal,
					unitLabel: `Chapter ${unitOrdinal + 1}`,
					endPosition: end(unitOrdinal),
					summary: `Lantern summary ${unitOrdinal + 1}.`,
					summaryCitations: [],
					observations: [
						{
							name: "Lantern",
							kind: "object",
							note: `Lantern note ${unitOrdinal + 1}.`,
							citations: [
								{
									locator: `${alpha.shortId}:v1:${unitOrdinal}.0`,
									quote: "The lantern",
									verified: unitOrdinal === 0,
								},
							],
						},
					],
					model: "mock",
				}),
			);
		}
	});

	it("loads a scope-limited map, including no unit when the bound is inside it", async () => {
		const { book: boundedBook, maps } = await mapThrough(end(1), "Chapter 2");
		const map = buildBookMapMessage([boundedBook], maps);
		expect(map).toContain("Chapter 2: Lantern summary 2.");
		expect(map).not.toContain("Lantern summary 3");
		const again = await mapThrough(end(1), "Chapter 2");
		expect(buildBookMapMessage([again.book], again.maps)).toBe(map);
		const inside = await mapThrough(end(0) - 1, "Before");
		expect(inside.maps.b1).toEqual([]);
		expect(buildBookMapMessage([inside.book], inside.maps)).toBeNull();
	});

	it("looks up only observations within the book's bound, in reading order", async () => {
		const bounded = { ...deps, books: [{ ...alpha, maxPosition: end(1) }] };
		const r = await lookupObservations(bounded, {
			book: "b1",
			name: "lantern",
		});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.results.map((o) => o.unitLabel)).toEqual([
			"Chapter 1",
			"Chapter 2",
		]);
		expect(r.subject).toBe("Lantern");
		expect(r.results.map((o) => [o.observedAs, o.source])).toEqual([
			["Lantern", "generated"],
			["Lantern", "generated"],
		]);
		expect(r.results.map((o) => o.citations[0]?.verified)).toEqual([
			true,
			false,
		]);
		expect(JSON.stringify(r)).not.toContain("Lantern note 3");
		expect(r.message).toContain("guide, not evidence");
		const whole = await lookupObservations(
			{ ...deps, books: [{ ...alpha, maxPosition: null }] },
			{ book: "b1", name: "lantern", limit: 1 },
		);
		expect(whole).toMatchObject({ status: "ok", count: 1, truncated: true });
	});

	it("rejects other books and distinguishes unavailable from a name not found", async () => {
		expect(
			await lookupObservations(deps, { book: "b9", name: "Lantern" }),
		).toMatchObject({ status: "unknown_book" });
		expect(
			await lookupObservations(deps, { book: "b2", name: "Lantern" }),
		).toMatchObject({ status: "unavailable" });
		expect(
			await lookupObservations(
				{ ...deps, books: [{ ...alpha, maxPosition: end(0) }] },
				{ book: "b1", name: "Nobody" },
			),
		).toMatchObject({
			status: "not_found",
			message: expect.stringContaining("Search the text"),
		});
		expect(
			await lookupObservations(deps, { book: "b1", name: "Lantern" }),
		).toMatchObject({ status: "not_found" });
	});

	it("caps large notes, citation lists, and serialized observation results", async () => {
		await t.db.transaction((tx) =>
			saveUnitResult(tx, alpha.editionId, {
				unitOrdinal: 2,
				unitLabel: "Chapter 3",
				endPosition: end(2),
				summary: "Long observations.",
				summaryCitations: [],
				model: "mock",
				observations: Array.from({ length: 30 }, () => ({
					name: "Large",
					kind: "motif" as const,
					note: "x".repeat(2000),
					citations: Array.from({ length: 10 }, () => ({
						locator: "locator",
						quote: "q".repeat(2000),
						verified: false,
					})),
				})),
			}),
		);
		const r = await lookupObservations(
			{ ...deps, books: [{ ...alpha, maxPosition: null }] },
			{ book: "b1", name: "Large", limit: 500 },
		);
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.count).toBeGreaterThan(0);
		expect(r.count).toBeLessThanOrEqual(LIMITS.observations);
		expect(r.truncated).toBe(true);
		expect(JSON.stringify(r.results).length).toBeLessThanOrEqual(
			LIMITS.resultChars + r.count + 1,
		);
		expect(
			r.results.every(
				(o) =>
					o.note.length <= LIMITS.observationChars &&
					o.citations.length <= LIMITS.observationCitations,
			),
		).toBe(true);
	});

	it("omits maps and reports observations unavailable after preprocessing goes stale", async () => {
		await t.db.transaction((tx) => markDerivedStale(tx, alpha.editionId));
		const { maps, guideContext } = await loadBookMaps(t.db, [
			{ ...alpha, maxPosition: null, scopeLabel: null },
		]);
		expect(maps.b1).toEqual([]);
		expect(guideContext).toBeNull();
		expect(buildBookMapMessage([alpha], maps)).toBeNull();
		expect(
			await lookupObservations(deps, { book: "b1", name: "Lantern" }),
		).toMatchObject({ status: "unavailable" });
	});
});

describe("readPassage", () => {
	it("reads a passage with capped context", async () => {
		const found = await searchBooks(deps, { query: "lantern", book: "b2" });
		if (found.status !== "ok") throw new Error("expected ok");
		const locator = found.results.find((x) => x.position === 5)?.locator;
		expect(locator).toBeDefined();
		const r = await readPassage(deps, {
			locator: locator as string,
			context: 99,
		});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.book).toBe("b2");
		expect(r.section).toBe("Chapter 1");
		expect(r.before.length).toBeLessThanOrEqual(LIMITS.context);
		expect(r.after.map((p) => p.text)).toHaveLength(2);
		expect(r.passage.text).toContain("lantern");
	});

	it("hides passages and neighbours beyond the book's bound", async () => {
		const unbounded = {
			...deps,
			books: [{ ...alpha, maxPosition: null }],
		};
		const all = await searchBooks(unbounded, { query: "paragraph 11" });
		if (all.status !== "ok") throw new Error("expected ok");
		const far = all.results[0]?.locator as string;
		expect(await readPassage(deps, { locator: far })).toMatchObject({
			status: "not_found",
		});
		const nearEdge = await searchBooks(unbounded, { query: "paragraph 2" });
		if (nearEdge.status !== "ok") throw new Error("expected ok");
		const edge = await readPassage(deps, {
			locator: nearEdge.results[0]?.locator as string,
			context: 5,
		});
		if (edge.status !== "ok") throw new Error("expected ok");
		expect(edge.after.length).toBeLessThanOrEqual(1);
	});

	it("refuses a locator from outside the conversation", async () => {
		const locator = `${outsider.shortId}:v1:0.0`;
		expect(await readPassage(deps, { locator })).toEqual({
			status: "not_in_conversation",
			locator,
		});
	});

	it("reports not_found for malformed and unknown locators", async () => {
		expect(await readPassage(deps, { locator: "nonsense" })).toMatchObject({
			status: "not_found",
		});
		expect(
			await readPassage(deps, { locator: `${alpha.shortId}:v1:99.99` }),
		).toMatchObject({ status: "not_found" });
	});
});

describe("readSection", () => {
	let gamma: ConversationBook;
	const gammaDeps = (maxPosition: number | null = null): ToolDeps => ({
		...deps,
		books: [{ ...gamma, maxPosition }],
	});
	const filler = "word ".repeat(200);
	const paragraphs = (r: { passages: { text: string }[] }) =>
		r.passages.map((p) => Number(/paragraph (\d+)/.exec(p.text)?.[1]));
	const start = async (d: ToolDeps, chapter: number) => {
		const r = await getOutline(
			{ ...d, books: d.books.map((b) => ({ ...b, maxPosition: null })) },
			{},
		);
		if (r.status !== "ok") throw new Error("expected ok");
		return r.outlines[0]?.entries[chapter - 1]?.locator as string;
	};

	beforeAll(async () => {
		const g = await ingestBook(
			t.db,
			dataDir,
			await buildEpub({
				title: "Gamma",
				language: "en",
				chapters: [60, 3].map((count, c) => ({
					href: `g${c + 1}.xhtml`,
					title: `Part ${c + 1}`,
					body: Array.from(
						{ length: count },
						(_, k) => `<p>Gamma paragraph ${c * 60 + k + 1}. ${filler}</p>`,
					).join(""),
				})),
			}),
			"gamma.epub",
		);
		gamma = book(g, "Gamma", 0);
	});

	it("reads a section's consecutive passages and points at the next section", async () => {
		const unbounded = { ...deps, books: [{ ...alpha, maxPosition: null }] };
		const r = await readSection(unbounded, {
			locator: await start(unbounded, 1),
		});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r).toMatchObject({
			book: "b1",
			section: "Chapter 1",
			truncated: false,
			next: null,
			endOfSection: true,
			nextSection: await start(unbounded, 2),
		});
		expect(paragraphs(r)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
		expect(r).not.toHaveProperty("continuesBeyondScope");
	});

	it("starts mid-section at any passage locator", async () => {
		const unbounded = { ...deps, books: [{ ...alpha, maxPosition: null }] };
		const first = await readSection(unbounded, {
			locator: await start(unbounded, 1),
		});
		if (first.status !== "ok") throw new Error("expected ok");
		const r = await readSection(unbounded, {
			locator: first.passages[15]?.locator as string,
		});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(paragraphs(r)).toEqual([16, 17, 18, 19, 20]);
	});

	it("packs passages up to the budget and continues from `next` without gaps", async () => {
		const d = gammaDeps();
		const seen: string[] = [];
		const read: number[] = [];
		let locator: string | null = await start(d, 1);
		let calls = 0;
		let last: Awaited<ReturnType<typeof readSection>> | undefined;
		while (locator !== null) {
			const r = await readSection(d, { locator });
			if (r.status !== "ok") throw new Error("expected ok");
			expect(JSON.stringify(r.passages).length).toBeLessThanOrEqual(
				LIMITS.sectionChars + r.passages.length,
			);
			expect(
				r.passages.every((p) => p.text.length <= LIMITS.passageChars),
			).toBe(true);
			expect(r.truncated).toBe(r.next !== null);
			seen.push(...r.passages.map((p) => p.locator));
			read.push(...paragraphs(r));
			locator = r.next;
			last = r;
			calls++;
		}
		expect(calls).toBeGreaterThan(1);
		expect(new Set(seen).size).toBe(seen.length);
		expect(read).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
		expect(last).toMatchObject({ endOfSection: true });
		const second = await readSection(d, {
			locator: (last as { nextSection: string }).nextSection,
		});
		if (second.status !== "ok") throw new Error("expected ok");
		expect(second.section).toBe("Part 2");
		expect(paragraphs(second)).toEqual([61, 62, 63]);
	});

	it("stops at the reading-scope bound and offers no cursor beyond it", async () => {
		const d = gammaDeps(30);
		const read: number[] = [];
		let locator: string | null = await start(d, 1);
		let last: Awaited<ReturnType<typeof readSection>> | undefined;
		while (locator !== null) {
			const r = await readSection(d, { locator });
			if (r.status !== "ok") throw new Error("expected ok");
			read.push(...paragraphs(r));
			locator = r.next;
			last = r;
		}
		expect(read).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
		expect(last).toMatchObject({
			next: null,
			truncated: false,
			endOfSection: false,
			continuesBeyondScope: true,
		});
		expect(last).not.toHaveProperty("nextSection");

		// Bound exactly at the section's end: no next section past it.
		const atEnd = await readSection(
			{ ...deps, books: [{ ...alpha, maxPosition: 20 }] },
			{ locator: await start(deps, 1) },
		);
		expect(atEnd).toMatchObject({
			status: "ok",
			endOfSection: true,
			nextSection: null,
			continuesBeyondScope: true,
		});
		const small = await readSection(deps, { locator: await start(deps, 1) });
		if (small.status !== "ok") throw new Error("expected ok");
		expect(paragraphs(small)).toEqual([1, 2]);
		expect(small.next).toBeNull();
	});

	it("reports not_found beyond the bound and for bad locators", async () => {
		expect(
			await readSection(deps, { locator: await start(deps, 2) }),
		).toMatchObject({ status: "not_found" });
		expect(await readSection(deps, { locator: "nonsense" })).toMatchObject({
			status: "not_found",
		});
		expect(
			await readSection(deps, { locator: `${alpha.shortId}:v1:99.99` }),
		).toMatchObject({ status: "not_found" });
	});

	it("refuses a locator from outside the conversation", async () => {
		const locator = `${outsider.shortId}:v1:0.0`;
		expect(await readSection(deps, { locator })).toEqual({
			status: "not_in_conversation",
			locator,
		});
	});
});

describe("getOutline", () => {
	const unbounded = () => ({
		...deps,
		books: deps.books.map((b) => ({
			...b,
			maxPosition: null,
			scopeLabel: null,
		})),
	});

	it("returns each book's whole table of contents when unbounded", async () => {
		const r = await getOutline(unbounded(), {});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.outlines.map((o) => o.book)).toEqual(["b1", "b2"]);
		expect(r.outlines[0]?.entries.map((e) => e.title)).toEqual([
			"Chapter 1",
			"Chapter 2",
			"Chapter 3",
		]);
		expect(r.outlines[0]).not.toHaveProperty("continuesBeyondScope");
		const one = await getOutline(unbounded(), { book: "b2" });
		if (one.status !== "ok") throw new Error("expected ok");
		expect(one.outlines).toHaveLength(1);
	});

	it("lists no entry beyond a book's bound and says the book continues", async () => {
		// Each chapter has 20 passages: Chapter 2 starts at position 21.
		const bounded = {
			...deps,
			books: [{ ...alpha, maxPosition: 40, scopeLabel: "Chapter 2" }],
		};
		const r = await getOutline(bounded, {});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.outlines[0]).toMatchObject({
			scope: "Chapter 2",
			continuesBeyondScope: true,
		});
		expect(r.outlines[0]?.entries.map((e) => e.title)).toEqual([
			"Chapter 1",
			"Chapter 2",
		]);
		const early = await getOutline(
			{
				...deps,
				books: [{ ...alpha, maxPosition: 20, scopeLabel: "Chapter 1" }],
			},
			{},
		);
		if (early.status !== "ok") throw new Error("expected ok");
		expect(early.outlines[0]?.entries.map((e) => e.title)).toEqual([
			"Chapter 1",
		]);
	});

	it("rejects an unknown book", async () => {
		expect(await getOutline(deps, { book: "b7" })).toMatchObject({
			status: "unknown_book",
		});
	});
});

describe("superseded and removed locators", () => {
	let versions: { id: string; shortId: string; sha256: string };

	beforeAll(async () => {
		const bytes = await fixtures.epub3();
		const v1 = await parseEpub(bytes);
		versions = await ingestBook(t.db, dataDir, bytes, "versions.epub", {
			parse: async () => v1,
		});
		const v2 = reshape(v1, 2, (ps, spine) => {
			if (spine === 1)
				return [
					{ ...(ps[0] as (typeof ps)[number]), text: "Inserted." },
					...ps,
				];
			if (spine === 2) return ps.filter((p) => p.text !== "Fourth.");
			return ps;
		});
		await ingestEdition(
			{
				db: t.db,
				dataDir,
				log: silentLog,
				parse: async () => v2,
				parserVersion: 2,
			},
			versions.sha256,
			{ finalAttempt: true },
		);
	});

	it("returns superseded and removed states as data", async () => {
		const scoped = { ...deps, books: [book(versions, "V", 0)] };
		expect(
			await readPassage(scoped, { locator: `${versions.shortId}:v1:1.1` }),
		).toMatchObject({
			status: "ok",
			superseded: true,
			passage: {
				locator: `${versions.shortId}:v2:1.2`,
				text: "Third.",
			},
		});
		expect(
			await readPassage(scoped, { locator: `${versions.shortId}:v1:2.1` }),
		).toEqual({ status: "removed", locator: `${versions.shortId}:v1:2.1` });
	});

	it("reads a section forward from a superseded locator", async () => {
		const scoped = { ...deps, books: [book(versions, "V", 0)] };
		const r = await readSection(scoped, {
			locator: `${versions.shortId}:v1:1.1`,
		});
		expect(r).toMatchObject({ status: "ok", superseded: true });
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.passages[0]).toMatchObject({
			locator: `${versions.shortId}:v2:1.2`,
			text: "Third.",
		});
		expect(
			await readSection(scoped, { locator: `${versions.shortId}:v1:2.1` }),
		).toEqual({ status: "removed", locator: `${versions.shortId}:v1:2.1` });
	});
});

describe("guide-aware lookups", () => {
	let gamma: ConversationBook;
	let units: ReadingUnit[];
	const unit = (i: number) => units[i] as ReadingUnit;
	/** Gamma's tool deps, scoped through unit `i` (null: whole book). */
	const through = (i: number | null): ToolDeps => ({
		...deps,
		books: [
			{
				...gamma,
				maxPosition: i === null ? null : unit(i).endPosition,
				scopeLabel: i === null ? null : unit(i).label,
			},
		],
	});

	beforeAll(async () => {
		const e = await ingestBook(
			t.db,
			dataDir,
			await buildEpub({
				title: "Gamma",
				language: "en",
				chapters: chapters("ranger", 4),
			}),
			"gamma.epub",
		);
		gamma = book(e, "Gamma", 0);
		units = await getReadingUnits(t.db, e.id);
		expect(units).toHaveLength(3);
		// Strider in units 0 and 2, Aragorn in units 1 and 2.
		const seen = [["Strider"], ["Aragorn"], ["Strider", "Aragorn"]];
		for (const [i, names] of seen.entries()) {
			await t.db.transaction((tx) =>
				saveUnitResult(tx, e.id, {
					unitOrdinal: i,
					unitLabel: unit(i).label,
					endPosition: unit(i).endPosition,
					summary: `Ranger summary ${i + 1}.`,
					summaryCitations: [],
					observations: names.map((name) => ({
						name,
						kind: "character" as const,
						note: `${name} note ${i + 1}.`,
						citations: [],
					})),
					model: "mock",
				}),
			);
		}
		// "Strider = Aragorn" is revealed at the end of unit 1.
		const merged = await mergeSubjects(
			t.db,
			e.id,
			{ kind: "whole" },
			{
				targetRef: "k:aragorn",
				sourceRef: "k:strider",
				reveal: { kind: "unit", endPosition: unit(1).endPosition },
			},
		);
		if (!merged.ok) throw new Error(`merge refused: ${merged.reason}`);
		// The reader names the subject Aragorn, a name that spoils before the reveal.
		expect(
			await renameSubject(
				t.db,
				e.id,
				{ kind: "whole" },
				{ ref: merged.ref, displayKey: "aragorn" },
			),
		).toMatchObject({ ok: true });
	});

	it("returns observations under both names once the alias is revealed within scope", async () => {
		const r = await lookupObservations(through(2), {
			book: "b1",
			name: "Strider",
		});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.subject).toBe("Aragorn");
		// Reading order is by unit; observations within one unit come in any order.
		expect(r.results.map((o) => o.unitLabel)).toEqual([
			unit(0).label,
			unit(1).label,
			unit(2).label,
			unit(2).label,
		]);
		expect(
			r.results.map((o) => `${o.unitLabel}|${o.observedAs}|${o.note}`).sort(),
		).toEqual(
			[
				`${unit(0).label}|Strider|Strider note 1.`,
				`${unit(1).label}|Aragorn|Aragorn note 2.`,
				`${unit(2).label}|Strider|Strider note 3.`,
				`${unit(2).label}|Aragorn|Aragorn note 3.`,
			].sort(),
		);
	});

	it("keeps an unrevealed alias apart and never names the other subject", async () => {
		const r = await lookupObservations(through(0), {
			book: "b1",
			name: "Strider",
		});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.subject).toBe("Strider");
		expect(r.results.map((o) => o.observedAs)).toEqual(["Strider"]);
		expect(JSON.stringify(r).toLowerCase()).not.toContain("aragorn");
		// The other name has not appeared yet: nothing to return, nothing named.
		const other = await lookupObservations(through(0), {
			book: "b1",
			name: "Aragorn",
		});
		expect(other).toMatchObject({ status: "not_found" });
		expect(JSON.stringify(other)).not.toContain("Strider");
	});

	it("applies reader corrections: replaced text labelled, suppressed omitted", async () => {
		const replaced = await saveCorrection(t.db, gamma.editionId, {
			unitLocator: unit(0).startLocator,
			target: "observation",
			nameKey: "strider",
			action: "replace",
			text: "The reader's note on Strider.",
		});
		expect(replaced.ok).toBe(true);
		const suppressed = await saveCorrection(t.db, gamma.editionId, {
			unitLocator: unit(2).startLocator,
			target: "observation",
			nameKey: "aragorn",
			action: "suppress",
		});
		expect(suppressed.ok).toBe(true);
		const r = await lookupObservations(through(null), {
			book: "b1",
			name: "Aragorn",
		});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.results.map((o) => [o.observedAs, o.note, o.source])).toEqual([
			["Strider", "The reader's note on Strider.", "reader correction"],
			["Aragorn", "Aragorn note 2.", "generated"],
			["Strider", "Strider note 3.", "generated"],
		]);
		expect(JSON.stringify(r)).not.toContain("Strider note 1.");
		expect(JSON.stringify(r)).not.toContain("Aragorn note 3.");
		expect(r.message).toContain("reader correction");
		expect(r.message).toContain("still not evidence");
	});
});

describe("lookupNotes", () => {
	let delta: ConversationBook;
	let units: ReadingUnit[];
	const unit = (i: number) => units[i] as ReadingUnit;
	const through = (i: number | null): ToolDeps => ({
		...deps,
		books: [
			{
				...delta,
				maxPosition: i === null ? null : unit(i).endPosition,
				scopeLabel: i === null ? null : unit(i).label,
			},
		],
	});
	type NoteInput = Parameters<typeof createNote>[2];
	const note = async (
		title: string,
		body: string,
		anchor: NoteInput["anchor"],
		attachment?: NoteInput["attachment"],
	) => {
		const r = await createNote(t.db, delta.editionId, {
			title,
			body,
			anchor,
			attachment,
		});
		if (!r.ok) throw new Error(`note refused: ${r.reason}`);
		return r.note;
	};
	const atUnit = (i: number) => ({
		kind: "unit" as const,
		endPosition: unit(i).endPosition,
	});

	beforeAll(async () => {
		const e = await ingestBook(
			t.db,
			dataDir,
			await buildEpub({
				title: "Delta",
				language: "en",
				chapters: chapters("harbour", 4),
			}),
			"delta.epub",
		);
		delta = book(e, "Delta", 0);
		units = await getReadingUnits(t.db, e.id);
		for (const i of [0, 1, 2]) {
			await t.db.transaction((tx) =>
				saveUnitResult(tx, e.id, {
					unitOrdinal: i,
					unitLabel: unit(i).label,
					endPosition: unit(i).endPosition,
					summary: `Harbour summary ${i + 1}.`,
					summaryCitations: [],
					observations: [
						{
							name: "Harbourmaster",
							kind: "character",
							note: `Seen ${i + 1}.`,
							citations: [],
						},
					],
					model: "mock",
				}),
			);
		}
		await note(
			"Is the harbourmaster lying?",
			"I think he is secretly the villain.",
			atUnit(0),
			{ kind: "subject", ref: "k:harbourmaster" },
		);
		await note("Long thoughts", `Begin. ${"x".repeat(3000)}`, atUnit(1), {
			kind: "unit",
			unitLocator: unit(1).startLocator,
		});
		await note(
			"Chapter three twist",
			"The villain is revealed in the last chapter.",
			atUnit(2),
		);
		await note("After finishing", "The whole villain theory, confirmed.", {
			kind: "end",
		});
	});

	it("lists visible notes by title, attachment and anchor, attributed as the reader's", async () => {
		const r = await lookupNotes(through(1), { book: "b1" });
		if (r.status !== "ok" || r.mode !== "list")
			throw new Error("expected list");
		expect(r.attribution).toBe(NOTES_ATTRIBUTION);
		expect(r.attribution).toMatch(/reader's own notes/);
		expect(r.attribution).toMatch(/speculative/);
		expect(r.attribution).toMatch(/not text of the book/);
		expect(r.notes.map((n) => [n.title, n.attachedTo, n.asOf])).toEqual([
			[
				"Is the harbourmaster lying?",
				{ subject: "Harbourmaster" },
				unit(0).label,
			],
			["Long thoughts", { unit: unit(1).label }, unit(1).label],
		]);
		expect(r.notes.every((n) => !("body" in n))).toBe(true);
		expect(r).toMatchObject({ count: 2, truncated: false });
	});

	it("withholds notes beyond the scope without revealing that they exist", async () => {
		const text = JSON.stringify(await lookupNotes(through(1), { book: "b1" }));
		expect(text).not.toContain("Chapter three twist");
		expect(text).not.toContain("After finishing");
		// A query only a later note matches reads exactly like one nothing matches.
		const later = await lookupNotes(through(1), {
			book: "b1",
			query: "revealed in the last",
		});
		const nothing = await lookupNotes(through(1), {
			book: "b1",
			query: "no such words anywhere",
		});
		expect(later).toEqual(nothing);
		expect(later).toMatchObject({ status: "not_found" });
		// The end-of-book note shows only for the whole book.
		expect(
			JSON.stringify(await lookupNotes(through(null), { book: "b1" })),
		).toContain("After finishing");
		expect(
			JSON.stringify(await lookupNotes(through(2), { book: "b1" })),
		).not.toContain("After finishing");
	});

	it("returns matching notes by query or subject, with bodies", async () => {
		const byQuery = await lookupNotes(through(1), {
			book: "b1",
			query: "SECRETLY",
		});
		if (byQuery.status !== "ok" || byQuery.mode !== "query")
			throw new Error("expected query");
		expect(byQuery.notes.map((n) => [n.title, n.body])).toEqual([
			["Is the harbourmaster lying?", "I think he is secretly the villain."],
		]);
		expect(byQuery.attribution).toBe(NOTES_ATTRIBUTION);
		const bySubject = await lookupNotes(through(1), {
			book: "b1",
			subject: "harbourmaster",
		});
		if (bySubject.status !== "ok") throw new Error("expected ok");
		expect(bySubject.notes.map((n) => n.title)).toEqual([
			"Is the harbourmaster lying?",
		]);
		// LIKE wildcards in a query are literal.
		expect(
			await lookupNotes(through(1), { book: "b1", query: "%" }),
		).toMatchObject({ status: "not_found" });
	});

	it("clips long bodies and says so", async () => {
		const r = await lookupNotes(through(1), { book: "b1", query: "Begin." });
		if (r.status !== "ok" || r.mode !== "query") throw new Error("expected ok");
		const [long] = r.notes;
		expect(long?.body.length).toBe(LIMITS.noteChars);
		expect(long?.clipped).toBe(true);
		expect(r.message).toContain(`${LIMITS.noteChars} characters`);
		const short = await lookupNotes(through(1), {
			book: "b1",
			query: "secretly",
		});
		if (short.status !== "ok" || short.mode !== "query")
			throw new Error("expected ok");
		expect(short.notes[0]?.clipped).toBeUndefined();
		expect(short).not.toHaveProperty("message");
	});

	it("caps listed titles and returned notes", async () => {
		for (let i = 0; i < 22; i++)
			await note(`Batch note ${i}`, "batch body", atUnit(0));
		const listed = await lookupNotes(through(0), { book: "b1" });
		if (listed.status !== "ok") throw new Error("expected ok");
		expect(listed.notes).toHaveLength(LIMITS.noteTitles);
		expect(listed.truncated).toBe(true);
		const queried = await lookupNotes(through(0), {
			book: "b1",
			query: "batch",
		});
		if (queried.status !== "ok") throw new Error("expected ok");
		expect(queried.notes).toHaveLength(LIMITS.notes);
		expect(queried.truncated).toBe(true);
	});

	it("reads exactly what slicing the unbounded list would show", async () => {
		// Its own batch: more than 20 titles, more than 5 matches.
		for (let i = 0; i < 22; i++)
			await note(`Slice batch note ${i}`, "batch body", atUnit(0));
		const clip = (s: string) =>
			s.length <= LIMITS.noteChars ? s : `${s.slice(0, LIMITS.noteChars - 1)}…`;
		const expected = async (i: number | null, cap: number, match?: string) => {
			const bound = i === null ? null : unit(i).endPosition;
			const all = await listNotes(
				t.db,
				delta.editionId,
				bound,
				{ kind: "all" },
				{ match },
			);
			if (all.length === 0) return { status: "not_found" };
			const shown = all.slice(0, cap);
			return {
				count: shown.length,
				truncated: all.length > shown.length,
				notes: shown.map((n) =>
					match === undefined
						? { id: n.id, title: n.title }
						: {
								id: n.id,
								title: n.title,
								body: clip(n.body),
								clipped: n.body.length > LIMITS.noteChars || undefined,
							},
				),
			};
		};
		const actual = async (i: number | null, query?: string) => {
			const r = await lookupNotes(through(i), { book: "b1", query });
			if (r.status !== "ok") return { status: r.status };
			return {
				count: r.count,
				truncated: r.truncated,
				notes: r.notes.map((n) =>
					"body" in n
						? { id: n.id, title: n.title, body: n.body, clipped: n.clipped }
						: { id: n.id, title: n.title },
				),
			};
		};
		for (const i of [0, 1, 2, null]) {
			const listed = await actual(i);
			expect(listed).toEqual(await expected(i, LIMITS.noteTitles));
			for (const query of ["batch", "villain", "Begin."])
				expect(await actual(i, query)).toEqual(
					await expected(i, LIMITS.notes, query),
				);
		}
		expect((await actual(0)).truncated).toBe(true);
		expect((await actual(0, "batch")).truncated).toBe(true);
		const [long] = (await actual(1, "Begin.")).notes ?? [];
		expect(long).toMatchObject({ title: "Long thoughts", clipped: true });
		// The note anchored at chapter three stays withheld before it.
		const villain = JSON.stringify(await actual(1, "villain"));
		expect(villain).toContain("Is the harbourmaster lying?");
		expect(villain).not.toContain("Chapter three twist");
	});

	it("refuses books outside the conversation", async () => {
		const r = await lookupNotes(through(null), { book: "b2" });
		expect(r).toMatchObject({ status: "unknown_book" });
		expect(JSON.stringify(r)).not.toContain("villain");
	});
});
