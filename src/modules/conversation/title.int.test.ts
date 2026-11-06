import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AiRuntime } from "#/modules/ai";
import { ensureEdition } from "#/modules/library";
import { aiUsage, NO_USAGE } from "#/modules/usage";
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
	deleteConversation,
	getConversation,
	listRecentConversations,
	renameConversation,
} from "./repository";
import { conversations } from "./schema";
import {
	claimTitle,
	dispatchTitles,
	expireTitles,
	finalizeTitle,
	runTitle,
	type TitleOutcome,
} from "./title";

const must = <T>(value: T | null | undefined): T => {
	if (value == null) throw new Error("Expected fixture value");
	return value;
};
let t: TestDb;
let editionId: string;
const selection = { provider: "openai", model: "captured" } as const;
const log = { warn: vi.fn(), info() {}, error() {} };
beforeAll(async () => {
	t = await createTestDb();
	editionId = (await ensureEdition(t.db, "title-fixture", "Book")).edition.id;
});
const row = async (id: string) =>
	(await t.db.select().from(conversations).where(eq(conversations.id, id)))[0];
const create = async () =>
	(await createConversation(t.db, { editionIds: [editionId] })).id;
const append = (
	id: string,
	text = "  Why\n does   the river matter? ",
	model: { provider: "openai"; model: string } = selection,
) =>
	appendMessage(t.db, {
		conversationId: id,
		role: "user",
		parts: [
			{ type: "text", text },
			{ type: "data-passage-context", data: { text: "SECRET ATTACHMENT" } },
		],
		namingSelection: model,
	});
const pending = async () => {
	const id = await create();
	await append(id);
	return id;
};
const result: TitleOutcome = {
	title: "The River's Narrative Role",
	usage: { ...NO_USAGE, inputTokens: 10, outputTokens: 5 },
	steps: 1,
	complete: true,
	provider: "openai",
	model: "captured",
};
function runtime(
	generate = vi.fn(async () => ({
		content: [{ type: "text", text: "The River's Narrative Role" }],
		finishReason: { unified: "stop", raw: undefined },
		usage: {
			inputTokens: {
				total: 10,
				noCache: 10,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: { total: 5, text: 5, reasoning: undefined },
		},
		warnings: [],
	})),
) {
	const model = new MockLanguageModelV4({ doGenerate: generate as never });
	const resolve = vi.fn(async (chosen) => ({
		ok: true as const,
		model,
		selection: chosen,
		providerOptions: { openai: { test: true } },
	}));
	return {
		ai: {
			available: async () => ["openai"],
			resolve,
			maxSteps: 8,
			temperature: undefined,
			reasoning: undefined,
		} as AiRuntime,
		generate,
		resolve,
		model,
	};
}
describe("durable title enrollment", () => {
	it("migrates populated and empty historical rows to ineligible, including old-version inserts", async () => {
		const url = await createEmptyDatabase();
		const handle = createDb(url);
		const folder = await mkdtemp(path.join(os.tmpdir(), "title-migration-"));
		try {
			await cp("drizzle", folder, { recursive: true });
			const journalPath = path.join(folder, "meta/_journal.json");
			const journal = JSON.parse(await readFile(journalPath, "utf8"));
			const target = journal.entries.findIndex(
				(entry: { tag: string }) => entry.tag === "0018_red_lethal_legion",
			);
			expect(target).toBeGreaterThan(0);
			journal.entries = journal.entries.slice(0, target);
			await writeFile(journalPath, JSON.stringify(journal));
			await runMigrations(handle.pool, log, folder);
			expect(
				(
					await handle.pool.query(
						"select 1 from information_schema.columns where table_name = 'conversations' and column_name = 'naming_state'",
					)
				).rowCount,
			).toBe(0);
			await handle.pool.query(
				"insert into conversations (id, title) values ($1, 'Old empty'), ($2, 'Old populated')",
				[randomUUID(), randomUUID()],
			);
			await handle.pool.query(
				'insert into messages (conversation_id, seq, role, parts) select id, 1, \'user\', \'[{"type":"text","text":"Old prompt"}]\'::json from conversations where title = \'Old populated\'',
			);
			await runMigrations(handle.pool, log);
			await handle.pool.query(
				"insert into conversations (title) values ('Old binary')",
			);
			expect(
				(await handle.db.select().from(conversations)).map(
					(c) => c.namingState,
				),
			).toEqual(["ineligible", "ineligible", "ineligible"]);
			expect((await row(await create()))?.namingState).toBe("eligible");
		} finally {
			await handle.pool.end();
			await rm(folder, { recursive: true, force: true });
		}
	});
	it("atomically enrolls concurrent first messages with only the winning selection", async () => {
		const id = await create();
		const saved = await Promise.all([
			append(id),
			append(id, "Second question", { ...selection, model: "other" }),
		]);
		const first = must(saved.find((m) => m.seq === 1));
		const parent = await row(id);
		expect(parent).toMatchObject({
			namingState: "pending",
			namingMessageId: first.id,
			namingModel: first === saved[0] ? "captured" : "other",
			title:
				first === saved[0] ? "Why does the river matter?" : "Second question",
		});
		expect(
			must(parent?.namingExpiresAt).getTime() - Date.now(),
		).toBeGreaterThan(290_000);
		await append(id, "Later default changed", {
			...selection,
			model: "changed",
		});
		expect((await row(id))?.namingModel).toBe(must(parent).namingModel);
	});
	it("rolls message and enrollment back together on an update failure", async () => {
		const id = await create();
		await t.pool.query(
			`create function fail_title_test() returns trigger language plpgsql as $$ begin if new.naming_state = 'pending' then raise exception 'test rollback'; end if; return new; end $$; create trigger fail_title_test before update on conversations for each row execute function fail_title_test()`,
		);
		try {
			await expect(append(id)).rejects.toThrow();
		} finally {
			await t.pool.query(
				"drop trigger fail_title_test on conversations; drop function fail_title_test()",
			);
		}
		expect((await getConversation(t.db, id))?.messages).toHaveLength(0);
		expect((await row(id))?.namingState).toBe("eligible");
	});
	it("keeps historical and manually renamed rows out of enrollment, preserving 60-character fallback", async () => {
		const old = await create();
		await t.db
			.update(conversations)
			.set({ namingState: "ineligible" })
			.where(eq(conversations.id, old));
		await append(old, "a ".repeat(80));
		expect((await row(old))?.title).toHaveLength(60);
		expect((await row(old))?.namingState).toBe("ineligible");
		for (const title of ["New conversation", "Why does the river matter?"]) {
			const id = await create();
			await renameConversation(t.db, id, title);
			await append(id);
			expect(await row(id)).toMatchObject({
				title,
				titleLocked: true,
				namingState: "skipped",
			});
		}
	});
});
describe("durable execution and finalization", () => {
	it("dispatches committed rows after lost sends, deduplicated claims survive redelivery/crash", async () => {
		const id = await pending();
		const enqueue = vi.fn(async () => null);
		await dispatchTitles({ db: t.db, enqueue });
		await dispatchTitles({ db: t.db, enqueue });
		expect(enqueue).toHaveBeenCalledWith("conversation.title", {
			conversationId: id,
		});
		const claims = await Promise.all([
			claimTitle(t.db, id),
			claimTitle(t.db, id),
		]);
		expect(claims.filter(Boolean)).toHaveLength(1);
		const r = runtime();
		await runTitle(
			{ db: t.db, ai: r.ai, log },
			id,
			new AbortController().signal,
		);
		expect(r.generate).not.toHaveBeenCalled();
		await t.db
			.update(conversations)
			.set({ namingDeadline: new Date(0) })
			.where(eq(conversations.id, id));
		await expireTitles(t.db);
		await runTitle(
			{ db: t.db, ai: r.ai, log },
			id,
			new AbortController().signal,
		);
		expect(r.generate).not.toHaveBeenCalled();
		expect((await row(id))?.namingState).toBe("failed");
	});
	it("expires absent-worker and saturated pending work without calling AI", async () => {
		const id = await pending();
		await t.db
			.update(conversations)
			.set({ namingExpiresAt: new Date(0) })
			.where(eq(conversations.id, id));
		const r = runtime();
		await runTitle(
			{ db: t.db, ai: r.ai, log },
			id,
			new AbortController().signal,
		);
		expect(r.resolve).not.toHaveBeenCalled();
		expect((await row(id))?.namingState).toBe("failed");
	});
	it("uses captured model and only opening text, one bounded call, independent from reply completion", async () => {
		const id = await pending();
		await append(id, "LATER SECRET");
		const r = runtime();
		await runTitle(
			{ db: t.db, ai: r.ai, log },
			id,
			new AbortController().signal,
		);
		expect(r.resolve).toHaveBeenCalledExactlyOnceWith(selection);
		expect(r.generate).toHaveBeenCalledTimes(1);
		const call = must(r.model.doGenerateCalls[0]);
		expect(call.maxOutputTokens).toBe(256);
		expect(call.providerOptions).toEqual({ openai: { test: true } });
		expect(call.tools).toBeUndefined();
		expect(JSON.stringify(call.prompt)).toContain("Why");
		expect(JSON.stringify(call.prompt)).not.toMatch(/SECRET/);
		expect(await row(id)).toMatchObject({
			title: result.title,
			namingState: "succeeded",
			titleLocked: false,
		});
		await runTitle(
			{ db: t.db, ai: r.ai, log },
			id,
			new AbortController().signal,
		);
		expect(r.generate).toHaveBeenCalledTimes(1);
	});
	it("records one usage row and leaves activity/cursor order intact", async () => {
		const id = await pending();
		const before = await row(id);
		const page = await listRecentConversations(t.db);
		const claim = must(await claimTitle(t.db, id));
		await Promise.all([
			finalizeTitle(t.db, claim, result),
			finalizeTitle(t.db, claim, result),
		]);
		const usage = await t.db
			.select()
			.from(aiUsage)
			.where(eq(aiUsage.conversationId, id));
		expect(usage).toHaveLength(1);
		expect(usage[0]).toMatchObject({
			purpose: "conversation-title",
			messageId: null,
			editionId: null,
			attemptId: claim.namingAttemptId,
			model: "captured",
		});
		expect((await row(id))?.updatedAt).toEqual(must(before).updatedAt);
		expect(
			(await listRecentConversations(t.db)).items.map((c) => c.id),
		).toEqual(page.items.map((c) => c.id));
	});
	it("manual rename wins in both orders, including same-string rename, retaining reported usage", async () => {
		for (const before of [true, false]) {
			for (const title of [
				"Manual",
				"New conversation",
				"Why does the river matter?",
			]) {
				const id = await pending();
				const claim = must(await claimTitle(t.db, id));
				if (before) await renameConversation(t.db, id, title);
				await finalizeTitle(t.db, claim, result);
				if (!before) await renameConversation(t.db, id, title);
				expect((await row(id))?.title).toBe(title);
				expect(
					await t.db
						.select()
						.from(aiUsage)
						.where(eq(aiUsage.conversationId, id)),
				).toHaveLength(1);
			}
		}
	});
	it("deleted parents before claim and during accounting are discarded without recreation", async () => {
		const id = await pending();
		const claim = must(await claimTitle(t.db, id));
		await deleteConversation(t.db, id);
		await finalizeTitle(t.db, claim, result);
		expect(await row(id)).toBeUndefined();
		expect(await claimTitle(t.db, id)).toBeNull();
		expect(
			await t.db.select().from(aiUsage).where(eq(aiUsage.conversationId, id)),
		).toHaveLength(0);
	});
	it("late results retain usage without writing a title, no fallback on missing credentials", async () => {
		const id = await pending();
		const claim = must(await claimTitle(t.db, id));
		await t.db
			.update(conversations)
			.set({ namingDeadline: new Date(0) })
			.where(eq(conversations.id, id));
		await finalizeTitle(t.db, claim, result);
		await expireTitles(t.db);
		expect(await row(id)).toMatchObject({
			namingState: "failed",
			title: "Why does the river matter?",
		});
		expect(
			await t.db.select().from(aiUsage).where(eq(aiUsage.conversationId, id)),
		).toHaveLength(1);
		const unavailable = await pending();
		const r = runtime();
		r.ai.resolve = vi.fn(async () => ({
			ok: false as const,
			reason: "unavailable" as const,
		}));
		await runTitle(
			{ db: t.db, ai: r.ai, log },
			unavailable,
			new AbortController().signal,
		);
		expect(r.ai.resolve).toHaveBeenCalledTimes(1);
		expect(r.generate).not.toHaveBeenCalled();
	});
});

describe("provider failure, cancellation and local recovery", () => {
	it("makes no corrective call for invalid or truncated output, retaining complete reported counts", async () => {
		for (const text of [
			"",
			"First\nSecond",
			"a".repeat(101),
			"Here is the title: River",
			"Because the hero dies",
		]) {
			const id = await pending();
			const r = runtime(
				vi.fn(async () => ({
					content: [{ type: "text", text }],
					finishReason: { unified: "stop", raw: undefined },
					usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
					warnings: [],
				})) as never,
			);
			await runTitle(
				{ db: t.db, ai: r.ai, log },
				id,
				new AbortController().signal,
			);
			expect(r.generate).toHaveBeenCalledTimes(1);
			expect((await row(id))?.title).toBe("Why does the river matter?");
			expect((await row(id))?.namingState).toBe("failed");
			const [recorded] = await t.db
				.select()
				.from(aiUsage)
				.where(eq(aiUsage.conversationId, id));
			expect(recorded).toMatchObject({
				inputTokens: 10,
				outputTokens: 5,
				complete: true,
			});
		}
	});
	it("disables SDK retries even for a retryable provider error", async () => {
		const { APICallError } = await import("ai");
		const id = await pending();
		const r = runtime(
			vi.fn(async () => {
				throw new APICallError({
					message: "Retryable",
					url: "https://example.invalid",
					requestBodyValues: {},
					statusCode: 503,
					isRetryable: true,
				});
			}) as never,
		);
		await runTitle(
			{ db: t.db, ai: r.ai, log },
			id,
			new AbortController().signal,
		);
		expect(r.generate).toHaveBeenCalledTimes(1);
		expect((await row(id))?.namingState).toBe("failed");
		const [recorded] = await t.db
			.select()
			.from(aiUsage)
			.where(eq(aiUsage.conversationId, id));
		expect(recorded).toMatchObject({
			inputTokens: null,
			outputTokens: null,
			complete: false,
		});
	});
	it("worker abort is terminal and late provider results cannot write", async () => {
		const id = await pending();
		let finish!: () => void;
		let started!: () => void;
		const entered = new Promise<void>((r) => {
			started = r;
		});
		const r = runtime(
			vi.fn(async () => {
				started();
				await new Promise<void>((r) => {
					finish = r;
				});
				return {
					content: [{ type: "text", text: "Late River Result" }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {},
					warnings: [],
				};
			}) as never,
		);
		const abort = new AbortController();
		const running = runTitle({ db: t.db, ai: r.ai, log }, id, abort.signal);
		await entered;
		abort.abort();
		await running;
		finish();
		await new Promise((r) => setTimeout(r, 20));
		expect((await row(id))?.namingState).toBe("failed");
		expect((await row(id))?.title).toBe("Why does the river matter?");
	});
	it("deletion during provider execution discards both title and usage", async () => {
		const id = await pending();
		let finish!: () => void;
		let started!: () => void;
		const entered = new Promise<void>((r) => {
			started = r;
		});
		const r = runtime(
			vi.fn(async () => {
				started();
				await new Promise<void>((r) => {
					finish = r;
				});
				return {
					content: [{ type: "text", text: "River Discussion" }],
					finishReason: { unified: "stop", raw: undefined },
					usage: {},
					warnings: [],
				};
			}) as never,
		);
		const running = runTitle(
			{ db: t.db, ai: r.ai, log },
			id,
			new AbortController().signal,
		);
		await entered;
		await deleteConversation(t.db, id);
		finish();
		await running;
		expect(await row(id)).toBeUndefined();
		expect(
			await t.db.select().from(aiUsage).where(eq(aiUsage.conversationId, id)),
		).toHaveLength(0);
	});
	it("retries a local failed transaction without reinvoking the provider", async () => {
		const id = await pending();
		await t.pool.query(
			`create sequence title_persist_test_seq; create function fail_persist_test() returns trigger language plpgsql as $$ begin if new.purpose = 'conversation-title' and nextval('title_persist_test_seq') = 1 then raise exception 'local transient'; end if; return new; end $$; create trigger fail_persist_test before insert on ai_usage for each row execute function fail_persist_test()`,
		);
		const r = runtime();
		try {
			await runTitle(
				{ db: t.db, ai: r.ai, log },
				id,
				new AbortController().signal,
			);
		} finally {
			await t.pool.query(
				"drop trigger fail_persist_test on ai_usage; drop function fail_persist_test(); drop sequence title_persist_test_seq",
			);
		}
		expect(r.generate).toHaveBeenCalledTimes(1);
		expect((await row(id))?.namingState).toBe("succeeded");
		expect(
			await t.db.select().from(aiUsage).where(eq(aiUsage.conversationId, id)),
		).toHaveLength(1);
	});
	it("crash after receiving a result loses accounting but never invokes AI again", async () => {
		const id = await pending();
		await claimTitle(t.db, id); // Simulates process loss with a result only in memory.
		await t.db
			.update(conversations)
			.set({ namingDeadline: new Date(0) })
			.where(eq(conversations.id, id));
		const r = runtime();
		await runTitle(
			{ db: t.db, ai: r.ai, log },
			id,
			new AbortController().signal,
		);
		const { usageForConversation } = await import("#/modules/usage");
		expect((await usageForConversation(t.db, id)).naming).toMatchObject({
			missing: true,
			incomplete: true,
			unknown: true,
		});
		expect(r.generate).not.toHaveBeenCalled();
	});
});

describe("pruning and expiry boundaries", () => {
	it("removing one book preserves enrollment, last-book pruning cancels best-effort and prevents late writes", async () => {
		const { conversationEditions } = await import("./schema");
		const { pruneEmptyConversations } = await import("./repository");
		const other = (
			await ensureEdition(t.db, "second-title-book", "Second Book")
		).edition.id;
		const { id } = await createConversation(t.db, {
			editionIds: [editionId, other],
		});
		await append(id);
		const captured = await row(id);
		const claim = must(await claimTitle(t.db, id));
		await t.db
			.delete(conversationEditions)
			.where(eq(conversationEditions.editionId, other));
		expect(await pruneEmptyConversations(t.db)).toBe(0);
		expect((await row(id))?.namingMessageId).toBe(captured?.namingMessageId);
		await t.db
			.delete(conversationEditions)
			.where(eq(conversationEditions.conversationId, id));
		const cancel = vi.fn(async () => {
			throw new Error("queue unavailable");
		});
		expect(await pruneEmptyConversations(t.db, cancel)).toBe(1);
		expect(cancel).toHaveBeenCalledWith(id);
		await finalizeTitle(t.db, claim, result);
		expect(await row(id)).toBeUndefined();
	});
	it("execution timeout releases a worker slot even if the provider ignores abort", async () => {
		const id = await pending();
		const r = runtime(vi.fn(() => new Promise(() => {})) as never);
		const started = Date.now();
		await runTitle(
			{ db: t.db, ai: r.ai, log },
			id,
			new AbortController().signal,
		);
		expect(Date.now() - started).toBeLessThan(32_000);
		expect((await row(id))?.namingState).toBe("failed");
		expect(r.generate).toHaveBeenCalledTimes(1);
	});
});

it("failed queue cancellation cannot undo a manual rename or discard reported usage", async () => {
	const { cancelTitleBestEffort } = await import("./title");
	const id = await pending();
	const claim = must(await claimTitle(t.db, id));
	await renameConversation(t.db, id, "Manual title");
	const cancelJob = vi.fn(async () => {
		throw new Error("queue down");
	});
	await cancelTitleBestEffort({ cancelJob, log }, id);
	await finalizeTitle(t.db, claim, result);
	expect((await row(id))?.title).toBe("Manual title");
	expect(
		await t.db.select().from(aiUsage).where(eq(aiUsage.conversationId, id)),
	).toHaveLength(1);
});
it("retains token counts attached to failed provider calls as incomplete", async () => {
	const id = await pending();
	const r = runtime(
		vi.fn(async () => {
			throw Object.assign(new Error("provider interrupted"), {
				usage: {
					inputTokens: 12,
					outputTokens: 3,
					inputTokenDetails: { cacheReadTokens: 2 },
					outputTokenDetails: { reasoningTokens: 1 },
				},
			});
		}) as never,
	);
	await runTitle({ db: t.db, ai: r.ai, log }, id, new AbortController().signal);
	const [recorded] = await t.db
		.select()
		.from(aiUsage)
		.where(eq(aiUsage.conversationId, id));
	expect(recorded).toMatchObject({
		inputTokens: 12,
		outputTokens: 3,
		cacheReadTokens: 2,
		reasoningTokens: 1,
		cacheWriteTokens: null,
		complete: false,
	});
	expect(r.generate).toHaveBeenCalledTimes(1);
});

it("does not claim pending work that expires while waiting for a row lock", async () => {
	const id = await pending();
	await t.pool.query(
		"update conversations set naming_expires_at = clock_timestamp() + interval '100 milliseconds' where id=$1",
		[id],
	);
	const lock = await t.pool.connect();
	await lock.query("begin");
	await lock.query("select id from conversations where id=$1 for update", [id]);
	const blocked = claimTitle(t.db, id);
	try {
		await new Promise((r) => setTimeout(r, 200));
		await lock.query("commit");
		expect(await blocked).toBeNull();
	} finally {
		await lock.query("rollback");
		lock.release();
	}
	await expireTitles(t.db);
	expect((await row(id))?.namingState).toBe("failed");
});
