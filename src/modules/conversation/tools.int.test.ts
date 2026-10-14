import { beforeAll, describe, expect, it } from "vitest";
import { ingestEdition } from "#/modules/catalog";
import { parseEpub } from "#/modules/epub";
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

describe("getOutline", () => {
	it("returns each book's table of contents", async () => {
		const r = await getOutline(deps, {});
		if (r.status !== "ok") throw new Error("expected ok");
		expect(r.outlines.map((o) => o.book)).toEqual(["b1", "b2"]);
		expect(r.outlines[0]?.entries.map((e) => e.title)).toEqual([
			"Chapter 1",
			"Chapter 2",
			"Chapter 3",
		]);
		const one = await getOutline(deps, { book: "b2" });
		if (one.status !== "ok") throw new Error("expected ok");
		expect(one.outlines).toHaveLength(1);
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
});
