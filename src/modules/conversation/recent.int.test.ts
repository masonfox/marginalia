import { beforeAll, describe, expect, it } from "vitest";
import { encodeConversationCursor } from "#/lib/conversation-cursor";
import { ensureEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import {
	appendMessage,
	createConversation,
	deleteConversation,
	InvalidConversationCursorError,
	listRecentConversations,
	type RecentConversation,
} from ".";

// Each test file has its own database, and every test here sees every
// conversation, so each test clears the table first.
let t: TestDb;
let jest: string;
let lighthouse: string;
let paleKing: string;

const edition = async (sha: string, title: string) =>
	(await ensureEdition(t.db, sha, title)).edition.id;

/** Sets a conversation's timestamps, as `created_at`/`updated_at` literals. */
const stamp = (id: string, updated: string, created = updated) =>
	t.pool.query(
		"update conversations set updated_at = $2, created_at = $3 where id = $1",
		[id, updated, created],
	);

const create = async (editionIds: string[]) =>
	(await createConversation(t.db, { editionIds })).id;

/** Every page, following the cursor to the end. */
async function listAll(limit: number) {
	const pages: RecentConversation[][] = [];
	let cursor: string | undefined;
	do {
		const page = await listRecentConversations(t.db, { cursor, limit });
		pages.push(page.items);
		cursor = page.nextCursor ?? undefined;
	} while (cursor && pages.length < 50);
	return pages;
}

beforeAll(async () => {
	t = await createTestDb();
	jest = await edition("ij01", "Infinite Jest");
	lighthouse = await edition("tl02", "To the Lighthouse");
	paleKing = await edition("pk03", "The Pale King");
});

describe("listRecentConversations", () => {
	it("lists conversations across books, most recently active first, then most recently created", async () => {
		await t.pool.query("delete from conversations");
		const older = await create([jest]);
		const tieOld = await create([lighthouse]);
		const tieNew = await create([jest]);
		const newest = await create([lighthouse]);
		await stamp(older, "2026-01-01T00:00:00.000001Z");
		await stamp(tieOld, "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z");
		await stamp(tieNew, "2026-01-02T00:00:00Z", "2026-01-01T12:00:00Z");
		await stamp(newest, "2026-01-03T00:00:00Z");

		const page = await listRecentConversations(t.db);
		expect(page.items.map((c) => c.id)).toEqual([
			newest,
			tieNew,
			tieOld,
			older,
		]);
		expect(page.nextCursor).toBeNull();
	});

	it("moves a conversation to the top when it receives a message", async () => {
		await t.pool.query("delete from conversations");
		const first = await create([jest]);
		const second = await create([lighthouse]);
		await stamp(first, "2026-01-01T00:00:00Z");
		await stamp(second, "2026-01-02T00:00:00Z");
		await appendMessage(t.db, {
			conversationId: first,
			role: "user",
			parts: [{ type: "text", text: "Hal again" }],
		});
		const { items } = await listRecentConversations(t.db);
		expect(items.map((c) => c.id)).toEqual([first, second]);
	});

	it("pages to the end in order, telling microsecond-apart rows apart", async () => {
		await t.pool.query("delete from conversations");
		const ids: string[] = [];
		for (let i = 0; i < 7; i++) {
			const id = await create([jest]);
			// Microseconds apart, which a millisecond cursor would collapse.
			await stamp(id, `2026-01-01T00:00:00.00000${i}Z`);
			ids.unshift(id);
		}
		const pages = await listAll(3);
		expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);
		expect(pages.flat().map((c) => c.id)).toEqual(ids);
	});

	it("ends with a null cursor when the last page is exactly full", async () => {
		await t.pool.query("delete from conversations");
		for (let i = 0; i < 4; i++) await create([jest]);
		const pages = await listAll(2);
		expect(pages.map((p) => p.length)).toEqual([2, 2]);
	});

	it("does not repeat a shown conversation that becomes active between pages", async () => {
		await t.pool.query("delete from conversations");
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			const id = await create([jest]);
			await stamp(id, `2026-01-0${i + 1}T00:00:00Z`);
			ids.unshift(id);
		}
		const first = await listRecentConversations(t.db, { limit: 2 });
		const shown = first.items.map((c) => c.id);
		expect(shown).toEqual(ids.slice(0, 2));

		// A shown conversation and a not-yet-shown one become active; one is deleted.
		await appendMessage(t.db, {
			conversationId: ids[1] as string,
			role: "user",
			parts: [{ type: "text", text: "again" }],
		});
		await deleteConversation(t.db, ids[3] as string);
		const fresh = await create([lighthouse]);

		const rest: string[] = [];
		let cursor = first.nextCursor ?? undefined;
		while (cursor) {
			const page = await listRecentConversations(t.db, { cursor, limit: 2 });
			rest.push(...page.items.map((c) => c.id));
			cursor = page.nextCursor ?? undefined;
		}
		expect(rest).toEqual([ids[2], ids[4]]);
		expect(rest).not.toContain(fresh);
		for (const id of shown) expect(rest).not.toContain(id);
	});

	it("returns every book in its stored order with its scope and cover", async () => {
		await t.pool.query("delete from conversations");
		await t.pool.query(
			"update editions set cover_path = 'cover.jpg' where id = $1",
			[paleKing],
		);
		const { id } = await createConversation(t.db, {
			editionIds: [paleKing, jest, lighthouse],
			scopes: { [jest]: { maxPosition: 42, scopeLabel: "Year of Glad" } },
		});
		const [item] = (await listRecentConversations(t.db)).items;
		expect(item?.id).toBe(id);
		expect(item?.books).toEqual([
			{
				editionId: paleKing,
				title: "The Pale King",
				hasCover: true,
				scopeLabel: null,
			},
			{
				editionId: jest,
				title: "Infinite Jest",
				hasCover: false,
				scopeLabel: "Year of Glad",
			},
			{
				editionId: lighthouse,
				title: "To the Lighthouse",
				hasCover: false,
				scopeLabel: null,
			},
		]);
	});

	it("previews the latest message that has text, or null", async () => {
		await t.pool.query("delete from conversations");
		const empty = await create([jest]);
		const replied = await create([lighthouse]);
		await appendMessage(t.db, {
			conversationId: replied,
			role: "user",
			parts: [{ type: "text", text: "Why the lighthouse?" }],
		});
		await appendMessage(t.db, {
			conversationId: replied,
			role: "assistant",
			parts: [
				{ type: "text", text: "**James** wants to go" },
				{ type: "text", text: "tomorrow." },
			],
		});
		await appendMessage(t.db, {
			conversationId: replied,
			role: "assistant",
			parts: [{ type: "step-start" }],
			error: "provider failed",
		});
		const byId = new Map(
			(await listRecentConversations(t.db)).items.map((c) => [c.id, c]),
		);
		expect(byId.get(replied)?.preview).toBe("James wants to go tomorrow.");
		expect(byId.get(empty)?.preview).toBeNull();
	});

	it("caps the page size", async () => {
		await t.pool.query("delete from conversations");
		for (let i = 0; i < 3; i++) await create([jest]);
		const page = await listRecentConversations(t.db, { limit: 0 });
		expect(page.items).toHaveLength(1);
		expect(page.nextCursor).not.toBeNull();
	});

	it("rejects a cursor it did not issue", async () => {
		await expect(
			listRecentConversations(t.db, { cursor: "nope!" }),
		).rejects.toBeInstanceOf(InvalidConversationCursorError);
		// A well-formed cursor past every row is simply an empty page.
		const page = await listRecentConversations(t.db, {
			cursor: encodeConversationCursor({
				u: "1970-01-01T00:00:00.000000Z",
				c: "1970-01-01T00:00:00.000000Z",
				i: "00000000-0000-4000-8000-000000000000",
			}),
		});
		expect(page).toEqual({ items: [], nextCursor: null });
	});
});
