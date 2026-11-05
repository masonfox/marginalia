import { beforeAll, describe, expect, it } from "vitest";
import { getReadingUnits, type ReadingUnit } from "#/modules/catalog";
import { ensureEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { ingestBook, tempDataDir } from "../../../test/library";
import {
	createConversationForEditions,
	getConversation,
	listConversationsForEdition,
	listRecentConversations,
	MAX_CONVERSATION_BOOKS,
	newConversationBooksSchema,
} from ".";

let t: TestDb;
let first: { id: string };
let second: { id: string };
let firstUnits: ReadingUnit[];
let secondUnits: ReadingUnit[];

const book = (title: string) =>
	buildEpub({
		title,
		chapters: [1, 2, 3].map((n) => ({
			href: `c${n}.xhtml`,
			title: `Chapter ${n}`,
			body: `<p>${title}, chapter ${n}.</p>`,
		})),
	});

beforeAll(async () => {
	t = await createTestDb();
	const dataDir = await tempDataDir();
	first = await ingestBook(
		t.db,
		dataDir,
		await book("Infinite Jest"),
		"ij.epub",
	);
	second = await ingestBook(
		t.db,
		dataDir,
		await book("The Pale King"),
		"pk.epub",
	);
	firstUnits = await getReadingUnits(t.db, first.id);
	secondUnits = await getReadingUnits(t.db, second.id);
});

const through = (units: ReadingUnit[], i: number) => ({
	kind: "unit" as const,
	endPosition: (units[i] as ReadingUnit).endPosition,
});

/** Every conversation's id, to check that nothing was created. */
const allIds = async () =>
	(await listRecentConversations(t.db, { limit: 50 })).items.map((c) => c.id);

describe("starting a conversation about several books", () => {
	it("creates one conversation with both books in the reader's order and their own scopes", async () => {
		// The second book first, so the stored order cannot follow the id order by chance.
		const created = await createConversationForEditions(t.db, [
			{ editionId: second.id, scope: { kind: "whole" } },
			{ editionId: first.id, scope: through(firstUnits, 1) },
		]);
		if ("error" in created) throw new Error("expected a conversation");
		const detail = await getConversation(t.db, created.id);
		expect(
			detail?.books.map((b) => ({
				editionId: b.editionId,
				ordinal: b.ordinal,
				maxPosition: b.maxPosition,
				scopeLabel: b.scopeLabel,
			})),
		).toEqual([
			{ editionId: second.id, ordinal: 0, maxPosition: null, scopeLabel: null },
			{
				editionId: first.id,
				ordinal: 1,
				maxPosition: firstUnits[1]?.endPosition,
				scopeLabel: "Chapter 2",
			},
		]);
		for (const id of [first.id, second.id])
			expect(
				(await listConversationsForEdition(t.db, id)).map((c) => c.id),
			).toContain(created.id);
	});

	it("creates nothing and names a missing book", async () => {
		const before = await allIds();
		const missing = "00000000-0000-0000-0000-000000000000";
		expect(
			await createConversationForEditions(t.db, [
				{ editionId: first.id, scope: { kind: "whole" } },
				{ editionId: missing, scope: { kind: "whole" } },
			]),
		).toEqual({ error: "not_ready", editionId: missing });
		expect(await allIds()).toEqual(before);
	});

	it("creates nothing and names a book that is not ready", async () => {
		const before = await allIds();
		const { edition } = await ensureEdition(t.db, "beef01", "Processing");
		expect(
			await createConversationForEditions(t.db, [
				{ editionId: edition.id, scope: { kind: "whole" } },
				{ editionId: first.id, scope: { kind: "whole" } },
			]),
		).toEqual({ error: "not_ready", editionId: edition.id });
		expect(await allIds()).toEqual(before);
	});

	it("creates nothing and names the second book when its scope is stale", async () => {
		const before = await allIds();
		expect(
			await createConversationForEditions(t.db, [
				{ editionId: first.id, scope: through(firstUnits, 0) },
				{
					editionId: second.id,
					scope: {
						kind: "unit",
						endPosition: (secondUnits[0]?.endPosition ?? 0) - 1,
					},
				},
			]),
		).toEqual({ error: "stale_scope", editionId: second.id });
		expect(await allIds()).toEqual(before);
	});

	it("refuses duplicate books", async () => {
		const before = await allIds();
		await expect(
			createConversationForEditions(t.db, [
				{ editionId: first.id, scope: { kind: "whole" } },
				{ editionId: first.id, scope: through(firstUnits, 0) },
			]),
		).rejects.toThrow("distinct");
		expect(await allIds()).toEqual(before);
	});
});

describe("the books a new conversation request may name", () => {
	const ids = [1, 2, 3, 4].map(() => crypto.randomUUID());
	const books = (n: number) =>
		ids.slice(0, n).map((editionId) => ({
			editionId,
			scope: { kind: "whole" as const },
		}));

	it("accepts one to three distinct books", () => {
		expect(MAX_CONVERSATION_BOOKS).toBe(3);
		for (const n of [1, 2, 3])
			expect(newConversationBooksSchema.safeParse(books(n)).success).toBe(true);
	});

	it("rejects no books, four books, and duplicates", () => {
		expect(newConversationBooksSchema.safeParse([]).success).toBe(false);
		expect(newConversationBooksSchema.safeParse(books(4)).success).toBe(false);
		const [one] = books(1);
		expect(newConversationBooksSchema.safeParse([one, one]).success).toBe(
			false,
		);
	});
});
