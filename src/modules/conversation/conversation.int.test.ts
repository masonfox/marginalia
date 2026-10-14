import { beforeAll, describe, expect, it } from "vitest";
import { deleteEdition, ensureEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { silentLog, tempDataDir } from "../../../test/library";
import {
	appendMessage,
	createConversation,
	DEFAULT_TITLE,
	deleteConversation,
	getConversation,
	listConversationsForEdition,
	pruneEmptyConversations,
	renameConversation,
	setProvisionalTitle,
} from ".";

let t: TestDb;
let a: string;
let b: string;

const edition = async (sha: string, title: string) =>
	(await ensureEdition(t.db, sha, title)).edition.id;

beforeAll(async () => {
	t = await createTestDb();
	a = await edition("aa11", "Book A");
	b = await edition("bb22", "Book B");
});

describe("conversation repository", () => {
	it("creates a single-book conversation with a default title", async () => {
		const { id } = await createConversation(t.db, { editionIds: [a] });
		const c = await getConversation(t.db, id);
		expect(c?.title).toBe(DEFAULT_TITLE);
		expect(c?.books.map((x) => [x.title, x.ordinal, x.maxPosition])).toEqual([
			["Book A", 0, null],
		]);
		expect(c?.messages).toEqual([]);
	});

	it("returns null for an unknown conversation", async () => {
		expect(
			await getConversation(t.db, "00000000-0000-0000-0000-000000000000"),
		).toBeNull();
	});

	it("supports a two-edition conversation listed under both books", async () => {
		const { id } = await createConversation(t.db, { editionIds: [a, b] });
		const c = await getConversation(t.db, id);
		expect(c?.books.map((x) => x.title)).toEqual(["Book A", "Book B"]);
		expect(
			(await listConversationsForEdition(t.db, a)).map((x) => x.id),
		).toContain(id);
		expect(
			(await listConversationsForEdition(t.db, b)).map((x) => x.id),
		).toContain(id);
	});

	it("appends messages with increasing seq and replays them in order", async () => {
		const { id } = await createConversation(t.db, { editionIds: [a] });
		const m1 = await appendMessage(t.db, {
			conversationId: id,
			role: "user",
			parts: [{ type: "text", text: "hi" }],
		});
		const m2 = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [{ type: "text", text: "hello" }],
			model: "m",
			finishReason: "stop",
			promptVersion: "v1",
		});
		expect([m1.seq, m2.seq]).toEqual([1, 2]);
		const c = await getConversation(t.db, id);
		expect(c?.messages.map((m) => [m.seq, m.role, m.finishReason])).toEqual([
			[1, "user", null],
			[2, "assistant", "stop"],
		]);
	});

	it("assigns distinct seq values to concurrent appends", async () => {
		const { id } = await createConversation(t.db, { editionIds: [a] });
		const results = await Promise.all(
			Array.from({ length: 5 }, () =>
				appendMessage(t.db, { conversationId: id, role: "user", parts: [] }),
			),
		);
		expect(results.map((r) => r.seq).sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it("orders the list by recent activity", async () => {
		const e = await edition("cc33", "Book C");
		const first = await createConversation(t.db, { editionIds: [e] });
		const second = await createConversation(t.db, { editionIds: [e] });
		await appendMessage(t.db, {
			conversationId: first.id,
			role: "user",
			parts: [],
		});
		const list = await listConversationsForEdition(t.db, e);
		expect(list.map((x) => x.id)).toEqual([first.id, second.id]);
		expect(list[0]?.messageCount).toBe(1);
	});

	it("sets a provisional title once and never over a rename", async () => {
		const { id } = await createConversation(t.db, { editionIds: [a] });
		expect(
			await setProvisionalTitle(t.db, id, "  What is the  green light? "),
		).toBe(true);
		expect(await setProvisionalTitle(t.db, id, "Second question")).toBe(false);
		expect((await getConversation(t.db, id))?.title).toBe(
			"What is the green light?",
		);

		const renamed = await createConversation(t.db, { editionIds: [a] });
		await renameConversation(t.db, renamed.id, "My title");
		expect(await setProvisionalTitle(t.db, renamed.id, "Ignored")).toBe(false);
		expect((await getConversation(t.db, renamed.id))?.title).toBe("My title");
	});

	it("truncates provisional titles to 60 characters", async () => {
		const { id } = await createConversation(t.db, { editionIds: [a] });
		await setProvisionalTitle(t.db, id, "x".repeat(100));
		expect((await getConversation(t.db, id))?.title).toHaveLength(60);
	});

	it("deletes a conversation with its messages", async () => {
		const { id } = await createConversation(t.db, { editionIds: [a] });
		await appendMessage(t.db, { conversationId: id, role: "user", parts: [] });
		expect(await deleteConversation(t.db, id)).toBe(true);
		expect(await getConversation(t.db, id)).toBeNull();
		const { rows } = await t.pool.query(
			"select count(*)::int as n from messages where conversation_id = $1",
			[id],
		);
		expect(rows[0].n).toBe(0);
		expect(await deleteConversation(t.db, id)).toBe(false);
	});

	it("removes the join row on edition deletion and prunes only emptied conversations", async () => {
		const x = await edition("dd44", "Book X");
		const y = await edition("ee55", "Book Y");
		const solo = await createConversation(t.db, { editionIds: [x] });
		const both = await createConversation(t.db, { editionIds: [x, y] });
		const dataDir = await tempDataDir();

		await deleteEdition(t.db, dataDir, x, silentLog);
		const { rows } = await t.pool.query(
			"select count(*)::int as n from conversation_editions where edition_id = $1",
			[x],
		);
		expect(rows[0].n).toBe(0);

		expect(await pruneEmptyConversations(t.db)).toBeGreaterThanOrEqual(1);
		expect(await getConversation(t.db, solo.id)).toBeNull();
		const remaining = await getConversation(t.db, both.id);
		expect(remaining?.books.map((k) => k.title)).toEqual(["Book Y"]);
	});
});
