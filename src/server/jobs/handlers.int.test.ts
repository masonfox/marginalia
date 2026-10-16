import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getBookMap,
	getPreprocessStatus,
	lookupObservations,
	saveUnitResult,
	updateRun,
} from "#/modules/analysis";
import { getReadingUnits, ingestEdition, passages } from "#/modules/catalog";
import { PARSER_VERSION, parseEpub } from "#/modules/epub";
import {
	createNote,
	END_OF_BOOK_POSITION,
	getCorrectionReview,
	getMergedObservations,
	getMergedSummaries,
	getReadingPosition,
	getUnitAnchors,
	guideCorrections,
	listGuideNotes,
	listGuideSubjects,
	listNotes,
	loadSubjectLinks,
	mergeSubjects,
	type NoteInput,
	saveCorrection,
	setReadingPosition,
} from "#/modules/guide";
import { getEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import {
	addUploadedBook,
	reshape,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import { type AppContext, setAppContext } from "../context";
import { jobHandlers } from "./handlers";

let t: TestDb;
let dataDir: string;
const OLD_VERSION = PARSER_VERSION + 1;
const ctx = {
	id: "job",
	retryCount: 0,
	finalAttempt: false,
	signal: new AbortController().signal,
};

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	setAppContext({
		db: t.db,
		config: { dataDir, preprocessAuto: false },
		log: silentLog,
		ai: { status: { enabled: false } },
		enqueue: async () => null,
	} as unknown as AppContext);
});

/** A ready edition parsed under another parser version, with a complete preprocessing run. */
async function preprocessedEdition(name: string) {
	const bytes = await buildEpub({
		title: name,
		language: "en",
		chapters: [{ href: "a.xhtml", title: "One", body: "<p>Anna waits.</p>" }],
	});
	const { sha256, edition } = await addUploadedBook(
		t.db,
		dataDir,
		bytes,
		`${name}.epub`,
	);
	const old = reshape(await parseEpub(bytes), OLD_VERSION, (ps) => ps);
	await ingestEdition(
		{
			db: t.db,
			dataDir,
			log: silentLog,
			parse: async () => old,
			parserVersion: OLD_VERSION,
		},
		sha256,
		{ finalAttempt: true },
	);
	await saveUnitResult(t.db, edition.id, {
		unitOrdinal: 0,
		unitLabel: "One",
		endPosition: 0,
		summary: "Anna waits.",
		summaryCitations: [],
		observations: [
			{ name: "Anna", kind: "character", note: "Waits.", citations: [] },
		],
		model: "m",
	});
	await updateRun(t.db, edition.id, { status: "complete", totalUnits: 1 });
	return { sha256, editionId: edition.id };
}

describe("reparse keeps the reading position", () => {
	it("keeps the position on the same text and label when positions shift", async () => {
		const bytes = await buildEpub({
			title: "reparse-position",
			chapters: [
				{ href: "part1.xhtml", body: "<h1>Part One</h1>" },
				{ href: "ch1.xhtml", body: "<h2>Chapter 1</h2><p>Alpha.</p>" },
				{ href: "ch2.xhtml", body: "<h2>Chapter 2</h2><p>Beta.</p>" },
				{ href: "ch3.xhtml", body: "<h2>Chapter 3</h2><p>Gamma.</p>" },
			],
			toc: [
				{
					label: "Part One",
					href: "part1.xhtml",
					children: [
						{ label: "Chapter 1", href: "ch1.xhtml" },
						{ label: "Chapter 2", href: "ch2.xhtml" },
						{ label: "Chapter 3", href: "ch3.xhtml" },
					],
				},
			],
		});
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			bytes,
			"reparse-position.epub",
		);
		const current = await parseEpub(bytes);
		// The older parser missed Chapter 1's paragraph, so the reparse inserts it and shifts later positions.
		const old = reshape(current, OLD_VERSION, (ps, spine) =>
			spine === 1 ? ps.filter((p) => p.text !== "Alpha.") : ps,
		);
		const deps = { db: t.db, dataDir, log: silentLog };
		await ingestEdition(
			{ ...deps, parse: async () => old, parserVersion: OLD_VERSION },
			sha256,
			{ finalAttempt: true },
		);
		const [, second] = await getReadingUnits(t.db, edition.id);
		if (!second) throw new Error("expected units");
		await setReadingPosition(t.db, edition.id, {
			kind: "unit",
			endPosition: second.endPosition,
		});
		const textAt = async (position: number) => {
			const [row] = await t.db
				.select({ text: passages.text })
				.from(passages)
				.where(
					and(
						eq(passages.editionId, edition.id),
						eq(passages.position, position),
					),
				);
			return row?.text;
		};
		const before = await getReadingPosition(t.db, edition.id);
		if (before?.kind !== "unit") throw new Error("expected a unit position");
		const boundText = await textAt(before.maxPosition);

		await jobHandlers()["catalog.reparse"]?.({ editionId: edition.id }, ctx);
		expect((await getEdition(t.db, edition.id))?.parserVersion).toBe(
			PARSER_VERSION,
		);
		const after = await getReadingPosition(t.db, edition.id);
		expect(after).toEqual({
			kind: "unit",
			maxPosition: before.maxPosition + 1,
			scopeLabel: "Part One › Chapter 2",
		});
		expect(await textAt(before.maxPosition + 1)).toBe(boundText);
		// Still the end of the same, now current, unit.
		const [, now] = await getReadingUnits(t.db, edition.id);
		expect(now?.endPosition).toBe(before.maxPosition + 1);
	});
});

describe("reparse re-anchors alias reveals", () => {
	it("follows surviving text and moves a removed passage's reveal to the next survivor", async () => {
		const bytes = await buildEpub({
			title: "reparse-reveal",
			chapters: [
				{ href: "ch1.xhtml", body: "<h2>Chapter 1</h2><p>Alpha.</p>" },
				{
					href: "ch2.xhtml",
					body: "<h2>Chapter 2</h2><p>Beta.</p><p>Delta.</p>",
				},
				{ href: "ch3.xhtml", body: "<h2>Chapter 3</h2><p>Gamma.</p>" },
			],
		});
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			bytes,
			"reparse-reveal.epub",
		);
		const current = await parseEpub(bytes);
		// The older parser kept a stray paragraph between Beta and Delta, so
		// every later position shifts on reparse.
		const old = reshape(current, OLD_VERSION, (ps) =>
			ps.flatMap((p) =>
				p.text === "Beta." ? [p, { ...p, text: "A stray paragraph." }] : [p],
			),
		);
		const deps = { db: t.db, dataDir, log: silentLog };
		await ingestEdition(
			{ ...deps, parse: async () => old, parserVersion: OLD_VERSION },
			sha256,
			{ finalAttempt: true },
		);
		const passageOf = async (text: string) => {
			const [row] = await t.db
				.select({
					locator: passages.locator,
					position: passages.revealPosition,
				})
				.from(passages)
				.where(
					and(eq(passages.editionId, edition.id), eq(passages.text, text)),
				);
			if (!row) throw new Error(`no passage "${text}"`);
			return row;
		};
		const stray = await passageOf("A stray paragraph.");
		const gamma = await passageOf("Gamma.");
		const whole = { kind: "whole" } as const;
		for (const [target, source, at] of [
			["k:strider", "k:aragorn", stray],
			["k:lamia", "k:brawne lamia", gamma],
		] as const) {
			const merged = await mergeSubjects(t.db, edition.id, whole, {
				targetRef: target,
				sourceRef: source,
				reveal: { kind: "passage", locator: at.locator },
			});
			expect(merged.ok).toBe(true);
		}

		await jobHandlers()["catalog.reparse"]?.({ editionId: edition.id }, ctx);
		expect((await getEdition(t.db, edition.id))?.parserVersion).toBe(
			PARSER_VERSION,
		);
		const reveals = Object.fromEntries(
			(await loadSubjectLinks(t.db, edition.id)).links
				.filter((l) => !l.isPrimary)
				.map((l) => [
					l.nameKey,
					{ locator: l.revealLocator, position: l.revealPosition },
				]),
		);
		const delta = await passageOf("Delta.");
		const beta = await passageOf("Beta.");
		// Removed: the next surviving passage, never an earlier one.
		expect(reveals.aragorn).toEqual(delta);
		expect(delta.position).toBeGreaterThan(beta.position);
		// Surviving: the same text at its new position.
		const gammaNow = await passageOf("Gamma.");
		expect(gammaNow.position).toBe(gamma.position - 1);
		expect(reveals["brawne lamia"]).toEqual(gammaNow);
	});
});

describe("reparse re-anchors corrections", () => {
	/** Ingests `bytes` as parsed by an older parser, edited by `old`. */
	async function olderParse(
		name: string,
		bytes: Buffer,
		old: (
			current: Awaited<ReturnType<typeof parseEpub>>,
		) => Awaited<ReturnType<typeof parseEpub>>,
	) {
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			bytes,
			`${name}.epub`,
		);
		const parsed = old(await parseEpub(bytes));
		await ingestEdition(
			{
				db: t.db,
				dataDir,
				log: silentLog,
				parse: async () => parsed,
				parserVersion: OLD_VERSION,
			},
			sha256,
			{ finalAttempt: true },
		);
		return edition.id;
	}

	/** Preprocesses every current unit, with an observation of Anna in each. */
	async function preprocess(editionId: string, prefix: string) {
		for (const unit of await getReadingUnits(t.db, editionId)) {
			await saveUnitResult(t.db, editionId, {
				unitOrdinal: unit.ordinal,
				unitLabel: unit.label,
				endPosition: unit.endPosition,
				summary: `${prefix} ${unit.label}`,
				summaryCitations: [],
				observations: [
					{ name: "Anna", kind: "character", note: unit.label, citations: [] },
				],
				model: "m",
			});
		}
	}

	it("keeps applying to a unit whose positions shift but whose first passage survives", async () => {
		const bytes = await buildEpub({
			title: "reparse-correction-shift",
			chapters: [
				{
					href: "ch1.xhtml",
					title: "Chapter 1",
					body: "<h2>Chapter 1</h2><p>Alpha.</p>",
				},
				{
					href: "ch2.xhtml",
					title: "Chapter 2",
					body: "<h2>Chapter 2</h2><p>Beta.</p>",
				},
				{
					href: "ch3.xhtml",
					title: "Chapter 3",
					body: "<h2>Chapter 3</h2><p>Gamma.</p>",
				},
			],
		});
		// The older parser missed Chapter 1's paragraph, so every later position shifts.
		const editionId = await olderParse("reparse-correction-shift", bytes, (p) =>
			reshape(p, OLD_VERSION, (ps, spine) =>
				spine === 0 ? ps.filter((x) => x.text !== "Alpha.") : ps,
			),
		);
		await preprocess(editionId, "Old");
		const [, before] = await getReadingUnits(t.db, editionId);
		if (!before) throw new Error("expected units");
		for (const input of [
			{ target: "summary", action: "replace", text: "Mine." },
			{
				target: "observation",
				nameKey: "anna",
				action: "replace",
				text: "Anna, corrected.",
			},
		] as const) {
			const saved = await saveCorrection(t.db, editionId, {
				...input,
				unitLocator: before.startLocator,
			});
			expect(saved.ok).toBe(true);
		}

		await jobHandlers()["catalog.reparse"]?.({ editionId }, ctx);
		expect((await getEdition(t.db, editionId))?.parserVersion).toBe(
			PARSER_VERSION,
		);
		const [, after] = await getReadingUnits(t.db, editionId);
		if (!after) throw new Error("expected units");
		expect(after.label).toBe(before.label);
		expect(after.startPosition).toBe(before.startPosition + 1);
		const stored = await t.db
			.select({
				unitLocator: guideCorrections.unitLocator,
				detached: guideCorrections.detached,
			})
			.from(guideCorrections)
			.where(eq(guideCorrections.editionId, editionId));
		expect(stored).toEqual([
			{ unitLocator: after.startLocator, detached: false },
			{ unitLocator: after.startLocator, detached: false },
		]);
		// Regenerated on the new structure, the corrections apply to Chapter 2 again.
		await preprocess(editionId, "New");
		const anchors = await getUnitAnchors(t.db, editionId);
		expect(
			(await getMergedSummaries(t.db, editionId, null, anchors)).map(
				(s) => s.summary,
			),
		).toEqual(["New Chapter 1", "Mine.", "New Chapter 3"]);
		expect(
			(await getMergedObservations(t.db, editionId, null, anchors)).map(
				(o) => o.note,
			),
		).toEqual(["Chapter 1", "Anna, corrected.", "Chapter 3"]);
	});

	it("detaches a correction whose unit was merged into another", async () => {
		const bytes = await buildEpub({
			title: "reparse-correction-merge",
			chapters: [
				{
					href: "ch1.xhtml",
					title: "Chapter 1",
					body: "<h2>Chapter 1</h2><p>Alpha.</p>",
				},
				{
					href: "ch2.xhtml",
					title: "Chapter 2",
					body: "<h2>Chapter 2</h2><p>Beta.</p>",
				},
				{
					href: "ch3.xhtml",
					title: "Chapter 3",
					body: "<h2>Chapter 3</h2><p>Gamma.</p><h2>Chapter 4</h2><p>Delta.</p>",
				},
			],
		});
		// The older parser made Chapter 4 a unit of its own; the current one
		// folds it into Chapter 3.
		const editionId = await olderParse(
			"reparse-correction-merge",
			bytes,
			(p) => {
				const old = reshape(p, OLD_VERSION, (ps) => ps);
				const fourth = old.sections[2]?.passages.find(
					(x) => x.text === "Chapter 4",
				);
				if (!fourth) throw new Error("expected Chapter 4");
				return {
					...old,
					toc: [
						...old.toc,
						{
							label: "Chapter 4",
							depth: 0,
							target: { spineIndex: 2, blockIndex: fourth.blockIndex },
							children: [],
						},
					],
				};
			},
		);
		await preprocess(editionId, "Old");
		const old = await getReadingUnits(t.db, editionId);
		expect(old.map((u) => u.label)).toEqual([
			"Chapter 1",
			"Chapter 2",
			"Chapter 3",
			"Chapter 4",
		]);
		const fourth = old[3] as (typeof old)[number];
		const third = old[2] as (typeof old)[number];
		for (const unit of [third, fourth]) {
			const saved = await saveCorrection(t.db, editionId, {
				target: "summary",
				unitLocator: unit.startLocator,
				action: "replace",
				text: `Mine, ${unit.label}.`,
			});
			expect(saved.ok).toBe(true);
		}

		await jobHandlers()["catalog.reparse"]?.({ editionId }, ctx);
		const units = await getReadingUnits(t.db, editionId);
		expect(units.map((u) => u.label)).toEqual([
			"Chapter 1",
			"Chapter 2",
			"Chapter 3",
		]);
		const stored = await t.db
			.select({
				text: guideCorrections.text,
				unitLocator: guideCorrections.unitLocator,
				detached: guideCorrections.detached,
			})
			.from(guideCorrections)
			.where(eq(guideCorrections.editionId, editionId))
			.orderBy(guideCorrections.id);
		expect(stored.map((c) => [c.text, c.detached])).toEqual([
			["Mine, Chapter 3.", false],
			["Mine, Chapter 4.", true],
		]);
		expect(stored[0]?.unitLocator).toBe(units[2]?.startLocator);
		// Applies nowhere: Chapter 3 shows only its own correction.
		await preprocess(editionId, "New");
		const anchors = await getUnitAnchors(t.db, editionId);
		expect(
			(await getMergedSummaries(t.db, editionId, null, anchors)).map(
				(s) => s.summary,
			),
		).toEqual(["New Chapter 1", "New Chapter 2", "Mine, Chapter 3."]);
		// Listed for review once the unit now holding it is within the bound.
		const review = await getCorrectionReview(t.db, editionId, {
			kind: "whole",
		});
		expect(review.ok && review.review.detached).toEqual([
			expect.objectContaining({
				target: "summary",
				text: "Mine, Chapter 4.",
				unitLabel: "Chapter 3",
			}),
		]);
		const early = await getCorrectionReview(t.db, editionId, {
			kind: "unit",
			endPosition: (units[1] as (typeof units)[number]).endPosition,
		});
		expect(early.ok && early.review.detached).toEqual([]);
	});
});

describe("reparse invalidates preprocessing", () => {
	it("hides derived rows after a reparse under a new parser version", async () => {
		const { sha256, editionId } = await preprocessedEdition("reparse-stale");
		await jobHandlers()["library.ingest"]?.({ sha256 }, ctx);
		expect((await getEdition(t.db, editionId))?.parserVersion).toBe(
			PARSER_VERSION,
		);
		expect((await getPreprocessStatus(t.db, editionId)).status).toBe("stale");
		expect(await getBookMap(t.db, editionId, null)).toEqual([]);
		expect(await lookupObservations(t.db, editionId, "Anna", null, 10)).toEqual(
			[],
		);
	});

	it("rolls back invalidation with a failed replacement", async () => {
		const { sha256, editionId } = await preprocessedEdition("reparse-fail");
		// Fails the final edition update, after the replace hook has run.
		await t.db.execute(sql`
			create function fail_ready() returns trigger language plpgsql as
			$$ begin raise exception 'replacement failed'; end $$`);
		await t.db.execute(
			sql.raw(`create trigger fail_ready before update on editions for each row
			when (new.id = '${editionId}') execute function fail_ready()`),
		);
		try {
			await expect(
				jobHandlers()["library.ingest"]?.({ sha256 }, ctx),
			).rejects.toThrow(/update "editions"/);
		} finally {
			await t.db.execute(sql`drop trigger fail_ready on editions`);
		}
		expect((await getEdition(t.db, editionId))?.parserVersion).toBe(
			OLD_VERSION,
		);
		expect((await getPreprocessStatus(t.db, editionId)).status).toBe(
			"complete",
		);
		expect(await getBookMap(t.db, editionId, null)).toHaveLength(1);
		expect(
			await lookupObservations(t.db, editionId, "Anna", null, 10),
		).toHaveLength(1);
	});
});

describe("reparse re-anchors notes", () => {
	it("forwards anchors never earlier and clears unit attachments that start no unit", async () => {
		const bytes = await buildEpub({
			title: "reparse-notes",
			chapters: [
				{
					href: "ch1.xhtml",
					title: "Chapter 1",
					body: "<h2>Chapter 1</h2><p>Alpha.</p>",
				},
				{
					href: "ch2.xhtml",
					title: "Chapter 2",
					body: "<h2>Chapter 2</h2><p>Beta.</p><p>Delta.</p>",
				},
				{
					href: "ch3.xhtml",
					title: "Chapter 3",
					body: "<h2>Chapter 3</h2><p>Gamma.</p><h2>Chapter 4</h2><p>Epsilon.</p>",
				},
			],
		});
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			bytes,
			"reparse-notes.epub",
		);
		// The older parser kept a stray paragraph after Beta, which the reparse
		// removes, and made Chapter 4 a unit of its own, which the current
		// parser folds into Chapter 3.
		const old = reshape(await parseEpub(bytes), OLD_VERSION, (ps) =>
			ps.flatMap((p) =>
				p.text === "Beta." ? [p, { ...p, text: "A stray paragraph." }] : [p],
			),
		);
		const fourth = old.sections[2]?.passages.find(
			(x) => x.text === "Chapter 4",
		);
		if (!fourth) throw new Error("expected Chapter 4");
		old.toc = [
			...old.toc,
			{
				label: "Chapter 4",
				depth: 0,
				target: { spineIndex: 2, blockIndex: fourth.blockIndex },
				children: [],
			},
		];
		await ingestEdition(
			{
				db: t.db,
				dataDir,
				log: silentLog,
				parse: async () => old,
				parserVersion: OLD_VERSION,
			},
			sha256,
			{ finalAttempt: true },
		);
		const before = await getReadingUnits(t.db, edition.id);
		expect(before.map((u) => u.label)).toEqual([
			"Chapter 1",
			"Chapter 2",
			"Chapter 3",
			"Chapter 4",
		]);
		const [one, , three, four] = before as [
			(typeof before)[number],
			(typeof before)[number],
			(typeof before)[number],
			(typeof before)[number],
		];
		const passageOf = async (text: string) => {
			const [row] = await t.db
				.select({
					locator: passages.locator,
					position: passages.revealPosition,
				})
				.from(passages)
				.where(
					and(eq(passages.editionId, edition.id), eq(passages.text, text)),
				);
			if (!row) throw new Error(`no passage "${text}"`);
			return row;
		};
		const stray = await passageOf("A stray paragraph.");
		const unitAt = (u: { endPosition: number }) =>
			({ kind: "unit", endPosition: u.endPosition }) as const;
		const make = async (title: string, input: Partial<NoteInput>) => {
			const made = await createNote(t.db, edition.id, {
				title,
				body: "",
				...input,
			});
			if (!made.ok) throw new Error(made.reason);
		};
		await make("Stray", {
			anchor: { kind: "passage", locator: stray.locator },
		});
		await make("One", {
			anchor: unitAt(one),
			attachment: { kind: "unit", unitLocator: three.startLocator },
		});
		await make("Three", {
			anchor: unitAt(three),
			attachment: { kind: "unit", unitLocator: four.startLocator },
		});
		await make("Four", { anchor: unitAt(four) });
		await make("Finished", { anchor: { kind: "end" } });

		await jobHandlers()["catalog.reparse"]?.({ editionId: edition.id }, ctx);
		expect((await getEdition(t.db, edition.id))?.parserVersion).toBe(
			PARSER_VERSION,
		);
		const after = await getReadingUnits(t.db, edition.id);
		expect(after.map((u) => u.label)).toEqual([
			"Chapter 1",
			"Chapter 2",
			"Chapter 3",
		]);
		const stored = Object.fromEntries(
			(await listNotes(t.db, edition.id, null)).map((n) => [
				n.title,
				{ asOf: n.asOf, unitLocator: n.unitLocator },
			]),
		);
		const alpha = await passageOf("Alpha.");
		const beta = await passageOf("Beta.");
		const delta = await passageOf("Delta.");
		const gamma = await passageOf("Gamma.");
		const epsilon = await passageOf("Epsilon.");
		// Removed: the next surviving passage, never an earlier one.
		expect(stored.Stray?.asOf).toEqual({
			kind: "passage",
			...delta,
			label: "Chapter 2",
		});
		expect(delta.position).toBeGreaterThan(beta.position);
		// A unit still ending at its passage stays that unit; its attachment
		// follows Chapter 3's first passage to its new position.
		expect(stored.One).toEqual({
			asOf: { kind: "unit", ...alpha, label: "Chapter 1" },
			unitLocator: after[2]?.startLocator,
		});
		expect(after[2]?.startPosition).toBe(three.startPosition - 1);
		// Chapter 3 now ends later, so its old end is a passage within it; the
		// attachment to Chapter 4, which starts no unit now, is cleared.
		expect(stored.Three).toEqual({
			asOf: { kind: "passage", ...gamma, label: "Chapter 3" },
			unitLocator: null,
		});
		// Chapter 4's end is now Chapter 3's.
		expect(stored.Four?.asOf).toEqual({
			kind: "unit",
			...epsilon,
			label: "Chapter 3",
		});
		expect(stored.Finished?.asOf).toEqual({
			kind: "end",
			locator: null,
			position: null,
			label: null,
		});
		// Every note stays listed in the Notes view.
		const listed = await listGuideNotes(t.db, edition.id, { kind: "whole" });
		expect(listed.ok && listed.notes).toHaveLength(5);
	});
});

describe("reparse re-anchors past the end of the book", () => {
	it("shows anchors on a removed final passage only for the whole book and detaches its correction", async () => {
		const bytes = await buildEpub({
			title: "reparse-terminal",
			chapters: [
				{
					href: "ch1.xhtml",
					title: "Chapter 1",
					body: "<h2>Chapter 1</h2><p>Alpha.</p>",
				},
				{
					href: "ch2.xhtml",
					title: "Chapter 2",
					body: "<h2>Chapter 2</h2><p>Beta.</p>",
				},
			],
		});
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			bytes,
			"reparse-terminal.epub",
		);
		// The older parser kept a stray closing paragraph as a unit of its own;
		// the reparse removes it, and nothing after it survives.
		const old = reshape(await parseEpub(bytes), OLD_VERSION, (ps) =>
			ps.flatMap((p) =>
				p.text === "Beta." ? [p, { ...p, text: "A stray coda." }] : [p],
			),
		);
		const coda = old.sections[1]?.passages.find(
			(x) => x.text === "A stray coda.",
		);
		if (!coda) throw new Error("expected the coda");
		old.toc = [
			...old.toc,
			{
				label: "Coda",
				depth: 0,
				target: { spineIndex: 1, blockIndex: coda.blockIndex },
				children: [],
			},
		];
		await ingestEdition(
			{
				db: t.db,
				dataDir,
				log: silentLog,
				parse: async () => old,
				parserVersion: OLD_VERSION,
			},
			sha256,
			{ finalAttempt: true },
		);
		/** Strider seen in the first unit, Aragorn in every later one. */
		const preprocess = async (prefix: string) => {
			for (const unit of await getReadingUnits(t.db, edition.id)) {
				await saveUnitResult(t.db, edition.id, {
					unitOrdinal: unit.ordinal,
					unitLabel: unit.label,
					endPosition: unit.endPosition,
					summary: `${prefix} ${unit.label}`,
					summaryCitations: [],
					observations: [
						{
							name: unit.ordinal === 0 ? "Strider" : "Aragorn",
							kind: "character",
							note: unit.label,
							citations: [],
						},
					],
					model: "m",
				});
			}
		};
		await preprocess("Old");
		const before = await getReadingUnits(t.db, edition.id);
		expect(before.map((u) => u.label)).toEqual([
			"Chapter 1",
			"Chapter 2",
			"Coda",
		]);
		const last = before[2] as (typeof before)[number];
		const [stray] = await t.db
			.select({ locator: passages.locator })
			.from(passages)
			.where(
				and(
					eq(passages.editionId, edition.id),
					eq(passages.text, "A stray coda."),
				),
			);
		if (!stray) throw new Error("expected the stray passage");
		expect(stray.locator).toBe(last.startLocator);
		const whole = { kind: "whole" } as const;
		const merged = await mergeSubjects(t.db, edition.id, whole, {
			targetRef: "k:strider",
			sourceRef: "k:aragorn",
			reveal: { kind: "passage", locator: stray.locator },
		});
		expect(merged.ok).toBe(true);
		const saved = await saveCorrection(t.db, edition.id, {
			target: "summary",
			unitLocator: last.startLocator,
			action: "replace",
			text: "Mine.",
		});
		expect(saved.ok).toBe(true);
		const made = await createNote(t.db, edition.id, {
			title: "Coda",
			body: "",
			anchor: { kind: "passage", locator: stray.locator },
		});
		if (!made.ok) throw new Error(made.reason);

		await jobHandlers()["catalog.reparse"]?.({ editionId: edition.id }, ctx);
		expect((await getEdition(t.db, edition.id))?.parserVersion).toBe(
			PARSER_VERSION,
		);
		const units = await getReadingUnits(t.db, edition.id);
		expect(units.map((u) => u.label)).toEqual(["Chapter 1", "Chapter 2"]);
		const final = {
			kind: "unit",
			endPosition: (units[1] as (typeof units)[number]).endPosition,
		} as const;
		await preprocess("New");

		// The alias keeps its locator and reveals past every unit.
		const aliases = (await loadSubjectLinks(t.db, edition.id)).links.filter(
			(l) => !l.isPrimary,
		);
		expect(aliases).toEqual([
			expect.objectContaining({
				nameKey: "aragorn",
				revealLocator: stray.locator,
				revealPosition: END_OF_BOOK_POSITION,
			}),
		]);
		const names = async (choice: typeof whole | typeof final) => {
			const listed = await listGuideSubjects(t.db, edition.id, choice);
			if (!listed.ok) throw new Error("expected subjects");
			return listed.subjects.map((s) => s.name).sort();
		};
		expect(await names(final)).toEqual(["Aragorn", "Strider"]);
		expect(await names(whole)).toHaveLength(1);

		// The correction keeps its locator, detached, and applies nowhere.
		const stored = await t.db
			.select({
				unitLocator: guideCorrections.unitLocator,
				detached: guideCorrections.detached,
			})
			.from(guideCorrections)
			.where(eq(guideCorrections.editionId, edition.id));
		expect(stored).toEqual([
			{ unitLocator: last.startLocator, detached: true },
		]);
		const anchors = await getUnitAnchors(t.db, edition.id);
		expect(
			(await getMergedSummaries(t.db, edition.id, null, anchors)).map(
				(s) => s.summary,
			),
		).toEqual(["New Chapter 1", "New Chapter 2"]);

		// The note is as of the end of the book.
		expect(
			(await listNotes(t.db, edition.id, null)).map((n) => n.asOf),
		).toEqual([{ kind: "end", locator: null, position: null, label: null }]);
		const atFinal = await listGuideNotes(t.db, edition.id, final);
		expect(atFinal.ok && atFinal.notes).toEqual([]);
		const atWhole = await listGuideNotes(t.db, edition.id, whole);
		expect(atWhole.ok && atWhole.notes).toHaveLength(1);
	});
});
