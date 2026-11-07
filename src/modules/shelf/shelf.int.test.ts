import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { isValidShelfCursor } from "#/lib/shelf-cursor";
import { readingPositions } from "#/modules/guide";
import {
	type EditionStatus,
	editions,
	ensureSource,
	libraryFiles,
} from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import {
	InvalidShelfCursorError,
	listReadingShelf,
	listShelf,
	type ShelfFilter,
	type ShelfQuery,
} from ".";

let t: TestDb;
/** Each describe block gets its own database, since the counts span the library. */
const freshDb = () =>
	beforeAll(async () => {
		t = await createTestDb();
	});

interface BookSpec {
	title: string;
	authors?: string[];
	status?: EditionStatus;
	/** The edition's source file; "none" means no file row at all. */
	file?: "available" | "missing" | "none";
	position?: "reading" | "finished";
}

async function addBook({
	title,
	authors = [],
	status = "ready",
	file = "available",
	position,
}: BookSpec): Promise<string> {
	const sha256 = randomBytes(32).toString("hex");
	const [row] = await t.db
		.insert(editions)
		.values({
			sha256,
			shortId: sha256.slice(0, 16),
			title,
			authors,
			status,
			error: status === "failed" ? "Not a valid EPUB" : null,
		})
		.returning({ id: editions.id });
	if (!row) throw new Error("insert failed");
	if (file !== "none") {
		const source = await ensureSource(t.db, "upload", "/books");
		await t.db.insert(libraryFiles).values({
			sourceId: source.id,
			relPath: `${sha256}.epub`,
			size: 1,
			mtime: new Date(),
			sha256,
			status: file,
		});
	}
	if (position) {
		await t.db.insert(readingPositions).values({
			editionId: row.id,
			maxPosition: position === "reading" ? 42 : null,
			scopeLabel: position === "reading" ? "Chapter 3" : null,
		});
	}
	return row.id;
}

const titles = async (query: ShelfQuery = {}) =>
	(await listShelf(t.db, { limit: 500, ...query })).items.map((i) => i.title);

describe("status", () => {
	freshDb();
	beforeAll(async () => {
		await addBook({ title: "A Processing", status: "processing" });
		await addBook({ title: "B Failed", status: "failed" });
		await addBook({ title: "C Missing", file: "missing" });
		await addBook({
			title: "D Missing Read",
			file: "missing",
			position: "reading",
		});
		await addBook({ title: "E No File", file: "none", position: "finished" });
		await addBook({ title: "F Fresh" });
		await addBook({ title: "G Reading", position: "reading" });
		await addBook({ title: "H Finished", position: "finished" });
	});

	it("shows one merged status per book", async () => {
		const page = await listShelf(t.db, {});
		expect(page.items.map((i) => [i.title, i.status, i.error ?? null])).toEqual(
			[
				["A Processing", "processing", null],
				["B Failed", "failed", "Not a valid EPUB"],
				["C Missing", "unavailable", null],
				["D Missing Read", "unavailable", null],
				["E No File", "unavailable", null],
				["F Fresh", "not-started", null],
				["G Reading", "reading", null],
				["H Finished", "finished", null],
			],
		);
	});

	it.each<[ShelfFilter, string[]]>([
		["not-started", ["F Fresh"]],
		["reading", ["G Reading"]],
		["finished", ["H Finished"]],
		[
			"attention",
			["A Processing", "B Failed", "C Missing", "D Missing Read", "E No File"],
		],
	])("filters to %s", async (status, expected) => {
		expect(await titles({ status })).toEqual(expected);
	});
});

describe("search", () => {
	freshDb();
	beforeAll(async () => {
		await addBook({
			title: "To the Lighthouse",
			authors: ["Virginia Woolf"],
			position: "finished",
		});
		await addBook({
			title: "Mrs Dalloway",
			authors: ["Virginia Woolf"],
			position: "reading",
		});
		await addBook({ title: "Orlando", authors: ["Virginia Woolf"] });
		await addBook({ title: "Woolf's Letters", status: "failed" });
		await addBook({
			title: "Good Omens",
			authors: ["Terry Pratchett", "Neil Gaiman"],
		});
		await addBook({ title: "100% Proof" });
		await addBook({ title: "1000 Years" });
		await addBook({ title: "snake_case" });
		await addBook({ title: "snakeXcase" });
		await addBook({ title: "back\\slash" });
		await addBook({ title: "backslash" });
		await addBook({ title: "Pending", status: "processing" });
	});

	it("matches part of a title", async () => {
		expect(await titles({ q: "lighthouse" })).toEqual(["To the Lighthouse"]);
	});

	it("matches any author, not just the first", async () => {
		expect(await titles({ q: "gaiman" })).toEqual(["Good Omens"]);
	});

	it("ignores case and surrounding whitespace", async () => {
		const expected = [
			"Mrs Dalloway",
			"Orlando",
			"To the Lighthouse",
			"Woolf's Letters",
		];
		expect(await titles({ q: "WOOLF" })).toEqual(expected);
		expect(await titles({ q: "  woolf\t" })).toEqual(expected);
	});

	it("treats a blank query as no search", async () => {
		expect(await titles({ q: "   " })).toHaveLength(12);
	});

	it("matches %, _, and \\ literally", async () => {
		expect(await titles({ q: "100%" })).toEqual(["100% Proof"]);
		expect(await titles({ q: "e_c" })).toEqual(["snake_case"]);
		expect(await titles({ q: "k\\s" })).toEqual(["back\\slash"]);
	});

	it.each<[ShelfFilter, string[]]>([
		["finished", ["To the Lighthouse"]],
		["reading", ["Mrs Dalloway"]],
		["not-started", ["Orlando"]],
		["attention", ["Woolf's Letters"]],
	])("combines with the %s filter", async (status, expected) => {
		expect(await titles({ q: "woolf", status })).toEqual(expected);
	});

	it("counts the library, the matches, what needs attention, and each status regardless of the search", async () => {
		const page = await listShelf(t.db, { q: "woolf", status: "finished" });
		expect(page).toMatchObject({
			total: 12,
			matching: 1,
			needsAttention: 2,
			processing: 1,
			statusCounts: { "not-started": 8, reading: 1, finished: 1 },
		});
		expect(await listShelf(t.db, {})).toMatchObject({
			total: 12,
			matching: 12,
			needsAttention: 2,
			processing: 1,
			statusCounts: { "not-started": 8, reading: 1, finished: 1 },
		});
		expect(await listShelf(t.db, { q: "nothing like this" })).toMatchObject({
			items: [],
			nextCursor: null,
			total: 12,
			matching: 0,
			needsAttention: 2,
			processing: 1,
			statusCounts: { "not-started": 8, reading: 1, finished: 1 },
		});
	});
});

describe("paging", () => {
	freshDb();
	beforeAll(async () => {
		// One statement, so every row shares created_at and the id breaks ties.
		await t.db.insert(editions).values(
			Array.from({ length: 130 }, (_, i) => {
				const sha256 = randomBytes(32).toString("hex");
				return {
					sha256,
					shortId: sha256.slice(0, 16),
					// Duplicate titles, differing only in case for some.
					title: `${i % 2 ? "book" : "Book"} ${i % 40}`,
					status: "processing" as const,
				};
			}),
		);
		await addBook({ title: "Book 7" });
	});

	async function walk(limit: number, between?: () => Promise<void>) {
		const ids: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await listShelf(t.db, { cursor, limit });
			expect(page.items.length).toBeLessThanOrEqual(limit);
			ids.push(...page.items.map((i) => i.id));
			cursor = page.nextCursor ?? undefined;
			if (cursor) await between?.();
		} while (cursor);
		return ids;
	}

	const ordered = async () =>
		(
			await t.db.execute<{ id: string }>(
				sql`select id from editions order by lower(title), created_at, id`,
			)
		).rows.map((r) => r.id);

	it("returns every edition exactly once, in title order", async () => {
		const ids = await walk(60);
		expect(ids).toHaveLength(131);
		expect(ids).toEqual(await ordered());
	});

	it("does not repeat a book when one is imported before the cursor", async () => {
		const before = await ordered();
		let n = 0;
		const ids = await walk(25, async () => {
			await addBook({ title: `Aardvark ${n++}` });
		});
		expect(n).toBeGreaterThan(0);
		expect(new Set(ids).size).toBe(ids.length);
		// The new books sort before the cursor, so the walk sees exactly the original list.
		expect(ids).toEqual(before);
	});

	it("counts only on the first page", async () => {
		const first = await listShelf(t.db, { limit: 10 });
		expect(first).toMatchObject({
			total: expect.any(Number),
			matching: expect.any(Number),
			needsAttention: expect.any(Number),
			processing: expect.any(Number),
			statusCounts: expect.any(Object),
		});
		expect(first.nextCursor).not.toBeNull();
		const next = await listShelf(t.db, {
			cursor: first.nextCursor ?? undefined,
			limit: 10,
		});
		expect(next.items.length).toBeGreaterThan(0);
		expect(next).toMatchObject({
			total: null,
			matching: null,
			needsAttention: null,
			processing: null,
			statusCounts: null,
		});
	});

	it("ends with a null cursor and no empty page", async () => {
		const page = await listShelf(t.db, { limit: 10_000 });
		expect(page.nextCursor).toBeNull();
	});

	it("rejects an invalid cursor", async () => {
		const forged = (value: unknown) =>
			Buffer.from(JSON.stringify(value)).toString("base64url");
		const bad = [
			"not a cursor!",
			"abc",
			forged({ t: "book", c: "yesterday", i: "x" }),
			forged({
				t: "book",
				c: "2026-02-31T00:00:00.000000Z",
				i: "00000000-0000-4000-8000-000000000000",
			}),
		];
		for (const cursor of bad) {
			expect(isValidShelfCursor(cursor)).toBe(false);
			await expect(listShelf(t.db, { cursor })).rejects.toBeInstanceOf(
				InvalidShelfCursorError,
			);
		}
		const { nextCursor } = await listShelf(t.db, { limit: 1 });
		expect(nextCursor && isValidShelfCursor(nextCursor)).toBe(true);
	});
});

describe("reading shelf", () => {
	freshDb();

	/** Sets the book's position as last changed `minutesAgo` minutes ago. */
	const touch = (id: string, minutesAgo: number) =>
		t.db
			.update(readingPositions)
			.set({
				updatedAt: sql`now() - make_interval(mins => ${minutesAgo})`,
			})
			.where(sql`${readingPositions.editionId} = ${id}`);

	it("is empty with a zero total before any import", async () => {
		expect(await listReadingShelf(t.db, { limit: 4 })).toEqual({
			items: [],
			total: 0,
			statusCounts: { "not-started": 0, reading: 0, finished: 0 },
		});
	});

	it("lists books being read, most recently updated position first", async () => {
		const dalloway = await addBook({
			title: "Mrs Dalloway",
			authors: ["Virginia Woolf"],
			position: "reading",
		});
		const jest = await addBook({
			title: "Infinite Jest",
			authors: ["David Foster Wallace"],
			position: "reading",
		});
		const orlando = await addBook({ title: "Orlando", position: "reading" });
		await touch(dalloway, 60 * 24);
		await touch(jest, 1);
		await touch(orlando, 60);
		// Excluded: not started, finished, unavailable, processing, failed.
		await addBook({ title: "Fresh" });
		await addBook({ title: "Done", position: "finished" });
		await addBook({ title: "Gone", file: "missing", position: "reading" });
		await addBook({ title: "No File", file: "none", position: "reading" });
		await addBook({ title: "Busy", status: "processing", position: "reading" });
		await addBook({ title: "Broken", status: "failed", position: "reading" });

		const shelf = await listReadingShelf(t.db, { limit: 4 });
		expect(shelf.total).toBe(9);
		// Unavailable, processing, and failed books count in no reading status.
		expect(shelf.statusCounts).toEqual({
			"not-started": 1,
			reading: 3,
			finished: 1,
		});
		expect(shelf.items).toEqual([
			{
				id: jest,
				title: "Infinite Jest",
				authors: ["David Foster Wallace"],
				hasCover: false,
				scopeLabel: "Chapter 3",
			},
			expect.objectContaining({ id: orlando, title: "Orlando" }),
			expect.objectContaining({ id: dalloway, title: "Mrs Dalloway" }),
		]);
		// The library's Reading filter agrees with the shelf.
		expect((await titles({ status: "reading" })).sort()).toEqual(
			shelf.items.map((i) => i.title).sort(),
		);
	});

	it("returns at most the limit, keeping the most recent", async () => {
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			const id = await addBook({ title: `Extra ${i}`, position: "reading" });
			await touch(id, 0);
			ids.push(id);
		}
		const shelf = await listReadingShelf(t.db, { limit: 4 });
		expect(shelf.items).toHaveLength(4);
		expect(
			shelf.items
				.slice(0, 3)
				.map((i) => i.id)
				.sort(),
		).toEqual([...ids].sort());
		expect(shelf.items[3]?.title).toBe("Infinite Jest");
		expect(shelf.total).toBe(12);
	});
});
