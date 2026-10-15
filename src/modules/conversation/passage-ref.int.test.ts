import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getReadingUnits, locatorAliases, passages } from "#/modules/catalog";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { ingestBook, tempDataDir } from "../../../test/library";
import {
	type ConversationDetail,
	checkPassageRef,
	createConversation,
	createConversationForEdition,
	getConversation,
} from ".";

let t: TestDb;
let book: { id: string; shortId: string };
let other: { id: string; shortId: string };
/** Passages of `book` in reading order. */
let rows: { locator: string; text: string }[];
let whole: ConversationDetail;
let bounded: ConversationDetail;

const LONG = `${"A very long paragraph. ".repeat(200)}End.`;

beforeAll(async () => {
	t = await createTestDb();
	const dataDir = await tempDataDir();
	book = await ingestBook(
		t.db,
		dataDir,
		await buildEpub({
			title: "Reference Book",
			chapters: [
				{
					href: "c1.xhtml",
					title: "Chapter 1",
					body: "<p>The first chapter begins here.</p><p>Second paragraph of chapter one.</p>",
				},
				{
					href: "c2.xhtml",
					title: "Chapter 2",
					body: `<p>${LONG}</p><p>Middle chapter text.</p>`,
				},
				{
					href: "c3.xhtml",
					title: "Chapter 3",
					body: "<p>Final chapter text, revealed late.</p>",
				},
			],
		}),
		"reference.epub",
	);
	other = await ingestBook(
		t.db,
		dataDir,
		await buildEpub({
			title: "Other Book",
			chapters: [{ href: "o.xhtml", body: "<p>Elsewhere entirely.</p>" }],
		}),
		"other.epub",
	);
	rows = await t.db
		.select({ locator: passages.locator, text: passages.text })
		.from(passages)
		.where(eq(passages.editionId, book.id))
		.orderBy(asc(passages.spineIndex), asc(passages.blockIndex));
	const units = await getReadingUnits(t.db, book.id);
	expect(units.map((u) => u.label)).toEqual([
		"Chapter 1",
		"Chapter 2",
		"Chapter 3",
	]);
	const load = async (id: string) =>
		(await getConversation(t.db, id)) as ConversationDetail;
	whole = await load(
		(await createConversation(t.db, { editionIds: [book.id] })).id,
	);
	const created = await createConversationForEdition(t.db, book.id, {
		kind: "unit",
		endPosition: units[0]?.endPosition as number,
	});
	if (!created || "error" in created) throw new Error("expected conversation");
	bounded = await load(created.id);
});

const find = (text: string) => {
	const row = rows.find((r) => r.text.startsWith(text));
	if (!row) throw new Error(`no passage starting "${text}"`);
	return row;
};

describe("checkPassageRef", () => {
	it("snapshots a whole passage from the stored book", async () => {
		const p = find("The first chapter");
		expect(
			await checkPassageRef(t.db, bounded, { locator: p.locator }),
		).toEqual({
			status: "ok",
			snapshot: {
				locator: p.locator,
				editionId: book.id,
				bookTitle: "Reference Book",
				sectionTitle: "Chapter 1",
				text: "The first chapter begins here.",
			},
		});
	});

	it("snapshots a range's text", async () => {
		const p = find("The first chapter");
		const result = await checkPassageRef(t.db, whole, {
			locator: p.locator,
			range: { start: 4, end: 17 },
		});
		expect(result).toMatchObject({
			status: "ok",
			snapshot: { range: { start: 4, end: 17 }, text: "first chapter" },
		});
	});

	it("forwards a superseded locator to the current passage", async () => {
		const p = find("Middle chapter");
		const old = `${book.shortId}:v0:1.7`;
		await t.db.insert(locatorAliases).values({
			editionId: book.id,
			oldLocator: old,
			targetLocator: p.locator,
			matchKind: "exact",
		});
		expect(await checkPassageRef(t.db, whole, { locator: old })).toMatchObject({
			status: "ok",
			snapshot: { locator: p.locator, text: "Middle chapter text." },
		});
	});

	it("rejects unknown and removed locators", async () => {
		expect(
			await checkPassageRef(t.db, whole, {
				locator: `${book.shortId}:v1:0.99`,
			}),
		).toEqual({ status: "invalid", reason: "not_found" });
		const removed = `${book.shortId}:v0:0.9`;
		await t.db.insert(locatorAliases).values({
			editionId: book.id,
			oldLocator: removed,
			targetLocator: null,
			matchKind: "removed",
		});
		expect(await checkPassageRef(t.db, whole, { locator: removed })).toEqual({
			status: "invalid",
			reason: "removed",
		});
	});

	it("rejects a passage of a book outside the conversation", async () => {
		const [o] = await t.db
			.select({ locator: passages.locator })
			.from(passages)
			.where(eq(passages.editionId, other.id));
		expect(
			await checkPassageRef(t.db, whole, { locator: o?.locator as string }),
		).toEqual({ status: "invalid", reason: "not_in_conversation" });
	});

	it("rejects ranges outside the text or covering only whitespace", async () => {
		const p = find("The first chapter");
		for (const range of [
			{ start: 0, end: p.text.length + 1 },
			{ start: 5, end: 5 },
			{ start: 3, end: 4 },
		])
			expect(
				await checkPassageRef(t.db, whole, { locator: p.locator, range }),
			).toEqual({ status: "invalid", reason: "bad_range" });
	});

	it("rejects referenced text over 4,000 characters", async () => {
		// The parser splits long paragraphs, so lengthen a stored passage directly.
		const p = find("A very long");
		await t.db
			.update(passages)
			.set({ text: LONG })
			.where(
				and(eq(passages.editionId, book.id), eq(passages.locator, p.locator)),
			);
		expect(LONG.length).toBeGreaterThan(4000);
		expect(await checkPassageRef(t.db, whole, { locator: p.locator })).toEqual({
			status: "invalid",
			reason: "too_long",
		});
		expect(
			await checkPassageRef(t.db, whole, {
				locator: p.locator,
				range: { start: 0, end: 4000 },
			}),
		).toMatchObject({ status: "ok" });
	});

	it("rejects a passage beyond the bound, naming its unit", async () => {
		const p = find("Final chapter");
		expect(
			await checkPassageRef(t.db, bounded, { locator: p.locator }),
		).toEqual({
			status: "out_of_scope",
			editionId: book.id,
			unitLabel: "Chapter 3",
		});
		expect(
			await checkPassageRef(t.db, whole, { locator: p.locator }),
		).toMatchObject({ status: "ok" });
	});
});
