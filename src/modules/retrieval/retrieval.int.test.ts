import { beforeAll, describe, expect, it } from "vitest";
import { ingestEdition } from "#/modules/catalog";
import { parseEpub } from "#/modules/epub";
import { setAppContext } from "#/server/context";
import { runSearch } from "#/server/retrieval";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { fixtures } from "../../../test/fixtures";
import {
	addUploadedBook,
	reshape,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import { createRetrieval, getSectionView, type Retrieval } from ".";

let t: TestDb;
let dataDir: string;
let retrieval: Retrieval;

/** Ingests bytes as a book; returns its edition id and short id. */
async function ingest(
	bytes: Buffer,
	name: string,
	over: Parameters<typeof ingestEdition>[0] extends infer D
		? Partial<D>
		: never = {},
) {
	const { sha256, edition } = await addUploadedBook(t.db, dataDir, bytes, name);
	await ingestEdition({ db: t.db, dataDir, log: silentLog, ...over }, sha256, {
		finalAttempt: true,
	});
	return { id: edition.id, shortId: edition.shortId, sha256 };
}

/**
 * 10 chapters × 100 paragraphs (positions 1–1000, no headings), plus a
 * non-linear endnotes document. Planted text at known positions.
 */
async function bigBook() {
	const planted = new Map<number, string>([
		[100, "The green light burned at the end of the dock."],
		[
			120,
			`A reference to the harbor note<a epub:type="noteref" href="notes.xhtml#n1">1</a>.`,
		],
		[300, "He was dreaming of the future every night."],
		[310, "“Old sport,” said Gatsby, smiling."],
		[320, "The sport was old and nobody cared."],
		[900, "Much later the green light flickered again."],
	]);
	for (let i = 0; i < 30; i++)
		planted.set(
			5 + i * 12,
			`A lantern swung in the window, lantern number ${i}.`,
		);
	const chapters = Array.from({ length: 10 }, (_, c) => ({
		href: `ch${c + 1}.xhtml`,
		title: `Chapter ${c + 1}`,
		body: Array.from({ length: 100 }, (_, k) => {
			const position = c * 100 + k + 1;
			return `<p>${planted.get(position) ?? `Filler paragraph ${position} in a quiet chapter.`}</p>`;
		}).join("\n"),
	}));
	return buildEpub({
		title: "Big Book",
		language: "en",
		chapters: [
			...chapters,
			{
				href: "notes.xhtml",
				linear: false,
				body: `<aside epub:type="footnote" id="n1"><p>The green light note explains the harbor.</p></aside><p>Unreferenced appendix mentioning the green light.</p>`,
			},
		],
	});
}

let big: { id: string; shortId: string };
let other: { id: string };
let klingon: { id: string };

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	retrieval = createRetrieval(t.db);
	big = await ingest(await bigBook(), "big.epub");
	other = await ingest(
		await buildEpub({
			title: "Other",
			chapters: [
				{
					href: "o.xhtml",
					body: "<p>Another green light shone across the bay.</p>",
				},
			],
		}),
		"other.epub",
	);
	klingon = await ingest(
		await buildEpub({
			title: "Unsupported",
			language: "tlh",
			chapters: [
				{ href: "k.xhtml", body: "<p>The warriors were dreaming loudly.</p>" },
			],
		}),
		"tlh.epub",
	);
});

const locators = (hits: { locator: string }[]) => hits.map((h) => h.locator);
const positionsOf = (
	hits: { position: number | null; revealPosition: number }[],
) => hits.map((h) => h.position ?? h.revealPosition);

describe("search", () => {
	it("scopes to one edition and ranks with highlighted snippets", async () => {
		const hits = await retrieval.search({
			editionId: big.id,
			query: "green light",
		});
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.every((h) => h.editionId === big.id)).toBe(true);
		const ranks = hits.map((h) => h.rank);
		expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
		const first = hits[0];
		expect(
			first?.snippet.some((s) => s.match && /green|light/i.test(s.text)),
		).toBe(true);
		expect(first?.locator).toMatch(
			new RegExp(`^${big.shortId}:v1:\\d+\\.\\d+$`),
		);
		expect(first?.sectionTitle).toMatch(/Chapter|null/);
	});

	it("searches across editions when unscoped", async () => {
		const hits = await retrieval.search({ query: "green light", limit: 50 });
		expect(new Set(hits.map((h) => h.editionId))).toEqual(
			new Set([big.id, other.id]),
		);
	});

	it("limits results to a set of editions with per-edition bounds", async () => {
		const both = await retrieval.search({
			query: "green light",
			editionIds: [
				{ editionId: big.id, maxPosition: 500 },
				{ editionId: other.id },
			],
			limit: 50,
		});
		expect(new Set(both.map((h) => h.editionId))).toEqual(
			new Set([big.id, other.id]),
		);
		const inBig = both.filter((h) => h.editionId === big.id);
		expect(inBig.every((h) => h.revealPosition <= 500)).toBe(true);
		expect(inBig.map((h) => h.position)).not.toContain(900);

		const onlyOther = await retrieval.search({
			query: "green light",
			editionIds: [{ editionId: other.id }],
		});
		expect(onlyOther.every((h) => h.editionId === other.id)).toBe(true);
		expect(
			await retrieval.search({ query: "green light", editionIds: [] }),
		).toEqual([]);
	});

	it("matches stemmed forms in English", async () => {
		const hits = await retrieval.search({ editionId: big.id, query: "dreams" });
		expect(hits.map((h) => h.position)).toEqual([300]);
	});

	it("matches exact phrases only", async () => {
		const hits = await retrieval.search({
			editionId: big.id,
			query: '"old sport"',
		});
		expect(hits.map((h) => h.position)).toEqual([310]);
		const loose = await retrieval.search({
			editionId: big.id,
			query: "old sport",
		});
		expect(loose.map((h) => h.position).sort()).toEqual([310, 320]);
	});

	it("never fails on malformed queries", async () => {
		await expect(
			retrieval.search({ editionId: big.id, query: '"green light' }),
		).resolves.toBeInstanceOf(Array);
		await expect(
			retrieval.search({ editionId: big.id, query: "-) OR ( !! & |" }),
		).resolves.toBeInstanceOf(Array);
		const unbalanced = await retrieval.search({
			editionId: big.id,
			query: '"green light',
		});
		expect(unbalanced.length).toBeGreaterThan(0);
		expect(await retrieval.search({ editionId: big.id, query: "   " })).toEqual(
			[],
		);
	});

	it("falls back to exact word forms for an unsupported language", async () => {
		expect(
			(await retrieval.search({ editionId: klingon.id, query: "dreaming" }))
				.length,
		).toBe(1);
		expect(
			await retrieval.search({ editionId: klingon.id, query: "dreams" }),
		).toEqual([]);
	});

	it("excludes passages beyond the bound and includes footnotes revealed earlier", async () => {
		const hits = await retrieval.search({
			editionId: big.id,
			query: "green light",
			maxPosition: 500,
		});
		const reveals = hits.map((h) => h.revealPosition);
		expect(reveals.every((r) => r <= 500)).toBe(true);
		expect(hits.map((h) => h.position)).toContain(100);
		expect(hits.map((h) => h.position)).not.toContain(900);
		const note = hits.find((h) => h.kind === "footnote");
		expect(note).toMatchObject({ position: null, revealPosition: 120 });
		// The unreferenced appendix passage is revealed only after the end.
		expect(hits.some((h) => h.revealPosition > 1000)).toBe(false);
		const unbounded = await retrieval.search({
			editionId: big.id,
			query: "green light",
		});
		expect(positionsOf(unbounded)).toContain(900);
	});

	it("fills the limit from within the bound", async () => {
		const hits = await retrieval.search({
			editionId: big.id,
			query: "lantern",
			maxPosition: 200,
			limit: 10,
		});
		expect(hits).toHaveLength(10);
		expect(hits.every((h) => h.revealPosition <= 200)).toBe(true);
		const page2 = await retrieval.search({
			editionId: big.id,
			query: "lantern",
			maxPosition: 200,
			limit: 10,
			offset: 10,
		});
		expect(page2.length).toBe(17 - 10);
		expect(new Set([...locators(hits), ...locators(page2)]).size).toBe(17);
	});

	it("gives a server-side caller the same bounded results as the UI server function", async () => {
		setAppContext({
			db: t.db,
			config: {} as never,
			log: silentLog,
			enqueue: async () => null,
			ai: {} as never,
			access: {} as never,
		});
		const input = {
			editionId: big.id,
			query: "lantern",
			maxPosition: 300,
			limit: 7,
		};
		expect(await runSearch(input)).toEqual(await retrieval.search(input));
	});
});

describe("resolve", () => {
	const loc = (spine: number, block: number) =>
		`${big.shortId}:v1:${spine}.${block}`;

	it("returns the passage with edition, section, TOC path, and position", async () => {
		const r = await retrieval.resolve(loc(0, 99));
		expect(r).toMatchObject({
			status: "found",
			superseded: false,
			currentLocator: loc(0, 99),
			passage: {
				text: "The green light burned at the end of the dock.",
				position: 100,
			},
			edition: { id: big.id, title: "Big Book" },
			section: { spineIndex: 0, title: "Chapter 1" },
			tocPath: ["Chapter 1"],
		});
	});

	it("returns up to N neighbours within the section, clipped at its edges", async () => {
		const middle = await retrieval.resolve(loc(1, 50), { context: 2 });
		if (middle.status !== "found") throw new Error("expected found");
		expect(middle.before.map((p) => p.blockIndex)).toEqual([48, 49]);
		expect(middle.after.map((p) => p.blockIndex)).toEqual([51, 52]);

		const start = await retrieval.resolve(loc(1, 0), { context: 2 });
		if (start.status !== "found") throw new Error("expected found");
		expect(start.before).toEqual([]);
		expect(start.after.map((p) => p.blockIndex)).toEqual([1, 2]);

		const end = await retrieval.resolve(loc(1, 99), { context: 3 });
		if (end.status !== "found") throw new Error("expected found");
		expect(end.before.map((p) => p.blockIndex)).toEqual([96, 97, 98]);
		expect(end.after).toEqual([]);
	});

	it("returns not-found for never-issued locators", async () => {
		for (const bogus of [
			"nonsense",
			`${big.shortId}:v1:0.5000`,
			`${big.shortId}:v9:0.0`,
			"000000000000:v1:0.0",
		]) {
			expect(await retrieval.resolve(bogus)).toEqual({
				status: "not_found",
				requestedLocator: bogus,
			});
		}
	});
});

describe("section view", () => {
	it("gives every passage its reveal position", async () => {
		const view = await getSectionView(t.db, `${big.shortId}:v1:1.9`);
		if (view.status !== "found") throw new Error("expected found");
		expect(view.passages).toHaveLength(100);
		expect(view.passages[9]).toMatchObject({
			position: 110,
			revealPosition: 110,
		});
		const notes = await getSectionView(t.db, `${big.shortId}:v1:10.0`);
		if (notes.status !== "found") throw new Error("expected found");
		expect(notes.passages[0]).toMatchObject({
			position: null,
			revealPosition: 120,
		});
	});
});

describe("superseded and removed locators", () => {
	let book: { id: string; shortId: string; sha256: string };
	const v = (n: number, spine: number, block: number) =>
		`${book.shortId}:v${n}:${spine}.${block}`;

	beforeAll(async () => {
		const bytes = await fixtures.epub3();
		const v1 = await parseEpub(bytes);
		book = await ingest(bytes, "versions.epub", { parse: async () => v1 });
		// v2 inserts a passage at the start of section 1 and drops "Fourth." from section 2.
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
			book.sha256,
			{ finalAttempt: true },
		);
	});

	it("forwards a superseded locator to the current passage", async () => {
		const r = await retrieval.resolve(v(1, 1, 1));
		expect(r).toMatchObject({
			status: "found",
			superseded: true,
			requestedLocator: v(1, 1, 1),
			currentLocator: v(2, 1, 2),
			passage: { text: "Third." },
		});
	});

	it("reports a removed locator distinctly from not-found", async () => {
		expect(await retrieval.resolve(v(1, 2, 1))).toMatchObject({
			status: "removed",
			requestedLocator: v(1, 2, 1),
			edition: { id: book.id },
		});
	});

	it("verifies a quote against a superseded locator", async () => {
		expect(await retrieval.verifyQuote(v(1, 1, 1), "third")).toMatchObject({
			status: "verified",
			superseded: true,
			currentLocator: v(2, 1, 2),
			range: { start: 0, end: 5 },
			matchedText: "Third",
		});
		expect(await retrieval.verifyQuote(v(1, 1, 1), "fourth")).toMatchObject({
			status: "mismatch",
		});
		expect(await retrieval.verifyQuote(v(1, 2, 1), "Fourth.")).toMatchObject({
			status: "removed",
		});
	});
});
