import { beforeAll, describe, expect, it } from "vitest";
import { createAi } from "#/modules/ai";
import { deleteEdition, ensureEdition } from "#/modules/library";
import { priceTable, recordUsage } from "#/modules/usage";
import { loadConfig } from "#/server/config";
import { createTestDb, type TestDb } from "../../../test/db";
import { silentLog, tempDataDir } from "../../../test/library";
import {
	appendMessage,
	createConversation,
	createConversationForEdition,
	deleteConversation,
	getConversation,
	getConversationWithUsage,
	listConversationsForEdition,
	pruneEmptyConversations,
	renameConversation,
} from ".";

let t: TestDb;
let readyId: string;

const SECRET = "sk-super-secret-key";

beforeAll(async () => {
	t = await createTestDb();
	const { edition } = await ensureEdition(t.db, "f00d", "Ready Book");
	await t.pool.query(
		"update editions set status = 'ready', parser_version = 1 where id = $1",
		[edition.id],
	);
	readyId = edition.id;
});

describe("conversation operations behind the server functions", () => {
	it("returns per-reply usage with estimates and a total, without secrets", async () => {
		const config = loadConfig({
			DATABASE_URL: "postgres://u:dbsecret@localhost:5432/m",
			AUTH_PASSWORD: "pw-secret",
			AI_PROVIDER: "anthropic",
			AI_MODEL: "claude-sonnet-5-5",
			AI_API_KEY: SECRET,
			AI_PRICES: '{"local-model": {"input": 1, "output": 1}}',
		});
		const created = await createConversationForEdition(t.db, readyId, {
			kind: "whole",
		});
		if (!created || "error" in created)
			throw new Error("expected a conversation");
		const id = created.id;
		await appendMessage(t.db, {
			conversationId: id,
			role: "user",
			parts: [{ type: "text", text: "hi" }],
		});
		const old = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [{ type: "text", text: "Old reply." }],
		});
		const priced = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [{ type: "text", text: "Priced." }],
		});
		const local = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [{ type: "text", text: "Local." }],
		});
		const base = {
			purpose: "conversation" as const,
			conversationId: id,
			provider: "anthropic",
			inputTokens: 1_000_000,
			outputTokens: 100_000,
			cacheReadTokens: 800_000,
			cacheWriteTokens: 0,
			reasoningTokens: null,
			steps: 3,
		};
		await recordUsage(t.db, {
			...base,
			messageId: priced.id,
			model: "claude-sonnet-5-5",
			complete: false,
		});
		await recordUsage(t.db, {
			...base,
			messageId: local.id,
			model: "local-model",
			complete: true,
		});

		const got = await getConversationWithUsage(
			t.db,
			id,
			priceTable(config.ai?.prices),
		);
		if (!got) throw new Error("expected a conversation");
		expect(got.messages).toHaveLength(4);
		expect(got.usage[old.id]).toBeUndefined();
		expect(got.usage[priced.id]).toMatchObject({
			model: "claude-sonnet-5-5",
			steps: 3,
			complete: false,
		});
		// 200K uncached × $2 + 800K cached × $0.10 + 100K out × $10, per MTok.
		expect(got.usage[priced.id]?.estimatedCost).toBeCloseTo(1.48);
		// Priced from AI_PRICES, cache reads at the input price.
		expect(got.usage[local.id]?.estimatedCost).toBeCloseTo(1.1);
		expect(got.usageTotal).toMatchObject({
			inputTokens: 2_000_000,
			outputTokens: 200_000,
			missing: 1,
		});
		expect(got.usageTotal.estimatedCost).toBeCloseTo(2.58);

		const sent = JSON.stringify(got);
		for (const secret of [SECRET, "dbsecret", "pw-secret"]) {
			expect(sent).not.toContain(secret);
		}
		expect(
			await getConversationWithUsage(t.db, crypto.randomUUID(), {}),
		).toBeNull();
	});

	it("creates, lists, gets, renames, and deletes a conversation", async () => {
		const created = await createConversationForEdition(t.db, readyId, {
			kind: "whole",
		});
		if (!created || "error" in created)
			throw new Error("expected a conversation");
		expect(
			(await listConversationsForEdition(t.db, readyId)).map((c) => c.id),
		).toContain(created.id);

		await appendMessage(t.db, {
			conversationId: created.id,
			role: "user",
			parts: [{ type: "text", text: "hello" }],
		});
		const got = await getConversation(t.db, created.id);
		expect(got?.books.map((b) => b.title)).toEqual(["Ready Book"]);
		expect(got?.messages).toHaveLength(1);

		expect(await renameConversation(t.db, created.id, "  Renamed  ")).toBe(
			true,
		);
		expect((await getConversation(t.db, created.id))?.title).toBe("Renamed");
		expect(await renameConversation(t.db, created.id, "   ")).toBe(false);

		expect(await deleteConversation(t.db, created.id)).toBe(true);
		expect(await getConversation(t.db, created.id)).toBeNull();
	});

	it("does not start a conversation for a missing or unready book", async () => {
		expect(
			await createConversationForEdition(
				t.db,
				"00000000-0000-0000-0000-000000000000",
				{ kind: "whole" },
			),
		).toBeNull();
		const { edition } = await ensureEdition(t.db, "beef", "Unready");
		expect(
			await createConversationForEdition(t.db, edition.id, { kind: "whole" }),
		).toBeNull();
	});

	it("deletes a book's conversations along with it, leaving others", async () => {
		const { edition } = await ensureEdition(t.db, "cafe", "Doomed");
		const doomed = await createConversation(t.db, { editionIds: [edition.id] });
		const other = await createConversation(t.db, { editionIds: [readyId] });
		await deleteEdition(t.db, await tempDataDir(), edition.id, silentLog);
		await pruneEmptyConversations(t.db);
		expect(await getConversation(t.db, doomed.id)).toBeNull();
		expect(await getConversation(t.db, other.id)).not.toBeNull();
	});

	it("exposes the AI status without the key", () => {
		const ai = createAi({
			provider: "openai",
			model: "gpt-test",
			preprocessModel: "gpt-test",
			apiKey: SECRET,
			baseUrl: undefined,
			maxSteps: 8,
			temperature: undefined,
			effort: undefined,
			promptCache: true,
			prices: {},
		});
		expect(ai.status).toEqual({
			enabled: true,
			provider: "openai",
			model: "gpt-test",
			preprocessModel: "gpt-test",
		});
		expect(JSON.stringify(ai.status)).not.toContain(SECRET);
		expect(createAi(undefined).status).toEqual({ enabled: false });
	});
});
