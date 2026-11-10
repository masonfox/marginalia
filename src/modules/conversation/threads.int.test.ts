import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureEdition } from "#/modules/library";
import { createDb } from "#/server/db";
import { runMigrations } from "#/server/db/migrate";
import {
	createEmptyDatabase,
	createTestDb,
	type TestDb,
} from "../../../test/db";
import {
	appendMessage,
	createConversation,
	createThreadWithMessage,
	deleteConversation,
	getConversation,
	getMessages,
	getThreadMessages,
	listConversationsForEdition,
	listRecentConversations,
	listThreads,
} from ".";

const silent = { info() {}, error() {} };

let t: TestDb;
let editionId: string;

const text = (s: string) => [{ type: "text", text: s }];

const newConversation = async () =>
	(await createConversation(t.db, { editionIds: [editionId] })).id;

/** A conversation with a question and an answer in the main conversation. */
async function withReply() {
	const id = await newConversation();
	const question = await appendMessage(t.db, {
		conversationId: id,
		role: "user",
		parts: text("What is the light?"),
	});
	const reply = await appendMessage(t.db, {
		conversationId: id,
		role: "assistant",
		parts: text("The green light stands for hope."),
		finishReason: "stop",
	});
	return { id, question: question.id, reply: reply.id };
}

const startThread = (
	conversationId: string,
	anchorMessageId: string,
	quote = "green light",
	message = "Tell me more",
) =>
	createThreadWithMessage(t.db, {
		conversationId,
		anchorMessageId,
		quote,
		message: { role: "user", parts: text(message) },
	});

async function counts() {
	const { rows } = await t.pool.query<{ threads: number; messages: number }>(
		"select (select count(*)::int from conversation_threads) as threads, (select count(*)::int from messages) as messages",
	);
	return rows[0];
}

beforeAll(async () => {
	t = await createTestDb();
	editionId = (await ensureEdition(t.db, "th01", "Thread Book")).edition.id;
});

describe("chat_threads migration", () => {
	it("applies to a database with existing conversations, whose messages read as main-conversation messages", async () => {
		// Migrate up to the migration before chat_threads, then store a conversation.
		const folder = mkdtempSync(path.join(tmpdir(), "marginalia-threads-"));
		cpSync("drizzle", folder, { recursive: true });
		const journalPath = path.join(folder, "meta", "_journal.json");
		const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
			entries: { tag: string }[];
		};
		const at = journal.entries.findIndex((e) => e.tag.endsWith("chat_threads"));
		expect(at).toBeGreaterThan(0);
		writeFileSync(
			journalPath,
			JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }),
		);
		const handle = createDb(await createEmptyDatabase());
		try {
			await runMigrations(handle.pool, silent, folder);
			const {
				rows: [conversation],
			} = await handle.pool.query<{ id: string }>(
				"insert into conversations (title) values ('Old') returning id",
			);
			await handle.pool.query(
				`insert into messages (conversation_id, seq, role, parts) values
				($1, 1, 'user', '[{"type":"text","text":"Old question"}]'),
				($1, 2, 'assistant', '[{"type":"text","text":"Old answer"}]')`,
				[conversation?.id],
			);

			await runMigrations(handle.pool, silent);

			const { rows } = await handle.pool.query<{ thread_id: string | null }>(
				"select thread_id from messages order by seq",
			);
			expect(rows).toEqual([{ thread_id: null }, { thread_id: null }]);
			const main = await getMessages(handle.db, conversation?.id as string);
			expect(main.map((m) => [m.seq, m.threadId])).toEqual([
				[1, null],
				[2, null],
			]);
			expect(await listThreads(handle.db, conversation?.id as string)).toEqual(
				[],
			);
		} finally {
			await handle.pool.end();
		}
	});
});

describe("thread repository", () => {
	it("creates a thread with its first message, sharing the conversation's seq", async () => {
		const { id, reply } = await withReply();
		const created = await startThread(id, reply, "  green light  ");
		if (created.status !== "ok") throw new Error(created.status);
		expect(created.seq).toBe(3);

		const [summary] = await listThreads(t.db, id);
		expect(summary).toMatchObject({
			id: created.threadId,
			anchorMessageId: reply,
			anchorQuote: "green light",
		});

		const detail = await getThreadMessages(t.db, id, created.threadId);
		expect(detail?.messages.map((m) => [m.id, m.threadId, m.seq])).toEqual([
			[created.id, created.threadId, 3],
		]);

		// The main conversation never includes thread messages.
		const conversation = await getConversation(t.db, id);
		expect(conversation?.messages.map((m) => m.seq)).toEqual([1, 2]);
		expect(conversation?.threads.map((th) => th.id)).toEqual([
			created.threadId,
		]);

		// Later main and thread appends keep one gap-free sequence.
		const main = await appendMessage(t.db, {
			conversationId: id,
			role: "user",
			parts: text("Back in main"),
		});
		const second = await appendMessage(t.db, {
			conversationId: id,
			threadId: created.threadId,
			role: "assistant",
			parts: text("Thread answer"),
		});
		expect([main.seq, second.seq]).toEqual([4, 5]);
		expect(
			(await getThreadMessages(t.db, id, created.threadId))?.messages.map(
				(m) => m.seq,
			),
		).toEqual([3, 5]);
	});

	it("keeps several threads on one reply, each with its own quote", async () => {
		const { id, reply } = await withReply();
		await startThread(id, reply, "green light");
		await startThread(id, reply, "hope");
		expect((await listThreads(t.db, id)).map((th) => th.anchorQuote)).toEqual([
			"green light",
			"hope",
		]);
	});

	it("rolls back and stores nothing for an invalid anchor or quote", async () => {
		const { id, question, reply } = await withReply();
		const other = await withReply();
		const errored = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: text("partial"),
			finishReason: "error",
			error: "boom",
		});
		const existing = await startThread(id, reply);
		if (existing.status !== "ok") throw new Error(existing.status);
		const threadReply = await appendMessage(t.db, {
			conversationId: id,
			threadId: existing.threadId,
			role: "assistant",
			parts: text("thread reply"),
			finishReason: "stop",
		});
		const before = await counts();

		for (const [anchor, quote] of [
			[question, "What"], // a reader message
			[errored.id, "partial"], // a failed reply that can be retried
			[other.reply, "green"], // another conversation's reply
			[threadReply.id, "thread"], // a reply inside a thread
			["00000000-0000-4000-8000-000000000000", "x"], // unknown
			[reply, "   "], // empty quote
			[reply, "x".repeat(2001)], // over-limit quote
		] as const) {
			expect(await startThread(id, anchor, quote)).toEqual({
				status: "invalid_anchor",
			});
		}
		expect(await counts()).toEqual(before);
	});

	it("accepts a saved incomplete reply as an anchor", async () => {
		const id = await newConversation();
		await appendMessage(t.db, {
			conversationId: id,
			role: "user",
			parts: text("Q"),
		});
		const stopped = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: text("Half an answer"),
			finishReason: "aborted",
		});
		expect((await startThread(id, stopped.id, "Half")).status).toBe("ok");
	});

	it("rejects appending to a thread of another conversation", async () => {
		const { id, reply } = await withReply();
		const created = await startThread(id, reply);
		if (created.status !== "ok") throw new Error(created.status);
		const other = await newConversation();
		await expect(
			appendMessage(t.db, {
				conversationId: other,
				threadId: created.threadId,
				role: "user",
				parts: text("sneaky"),
			}),
		).rejects.toThrow("thread not found");
		expect(await getThreadMessages(t.db, other, created.threadId)).toBeNull();
	});

	it("deletes threads and their messages with the conversation", async () => {
		const { id, reply } = await withReply();
		const created = await startThread(id, reply);
		if (created.status !== "ok") throw new Error(created.status);
		expect(await deleteConversation(t.db, id)).toBe(true);
		const { rows } = await t.pool.query(
			"select 1 from conversation_threads where id = $1 union all select 1 from messages where thread_id = $1",
			[created.threadId],
		);
		expect(rows).toEqual([]);
	});
});

describe("list previews with threads", () => {
	it("previews the latest main-conversation message while thread activity bumps the activity time", async () => {
		const { id, reply } = await withReply();
		await t.pool.query(
			"update conversations set updated_at = '2020-01-01T00:00:00Z' where id = $1",
			[id],
		);
		const created = await startThread(id, reply, "green", "Thread question");
		if (created.status !== "ok") throw new Error(created.status);
		await appendMessage(t.db, {
			conversationId: id,
			threadId: created.threadId,
			role: "assistant",
			parts: text("Thread answer"),
		});

		const [row] = (await listConversationsForEdition(t.db, editionId)).filter(
			(c) => c.id === id,
		);
		expect(row?.preview).toBe("The green light stands for hope.");
		expect(row?.updatedAt.getTime()).toBeGreaterThan(
			new Date("2020-01-02T00:00:00Z").getTime(),
		);
		const recent = await listRecentConversations(t.db);
		expect(recent.items[0]?.id).toBe(id);
		expect(recent.items[0]?.preview).toBe("The green light stands for hope.");

		const [thread] = await listThreads(t.db, id);
		expect(thread?.updatedAt.getTime()).toBeGreaterThanOrEqual(
			thread?.createdAt.getTime() ?? 0,
		);
	});
});
