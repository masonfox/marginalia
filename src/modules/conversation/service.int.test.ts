import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AiRuntime } from "#/modules/ai";
import { deleteEdition, ensureEdition } from "#/modules/library";
import { resetChatDefault, saveChatDefault } from "#/modules/settings";
import { aiUsage, priceTable, recordUsage } from "#/modules/usage";
import {
	AI_PROVIDERS,
	type AiProviderName,
	type AiSelection,
	loadConfig,
} from "#/server/config";
import { createTestDb, type TestDb } from "../../../test/db";
import { silentLog, tempDataDir } from "../../../test/library";
import { waitFor } from "../../../test/wait";
import {
	appendMessage,
	type ChatDeps,
	createConversation,
	createConversationForEdition,
	deleteConversation,
	getConversation,
	getConversationWithUsage,
	listConversationsForEdition,
	pruneEmptyConversations,
	renameConversation,
	setConversationModel,
	startChat,
} from ".";

let t: TestDb;
let readyId: string;

const SECRET = "sk-super-secret-key";

const textChunks = (text: string) => [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: text },
	{ type: "text-end", id: "t1" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: undefined },
		usage: {
			inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
			outputTokens: { total: 1, text: 1, reasoning: 0 },
		},
	},
];

/** A model that answers `text` once `gate` resolves. */
const replying = (text: string, gate: Promise<void> = Promise.resolve()) =>
	new MockLanguageModelV4({
		doStream: async () => {
			await gate;
			return {
				stream: new ReadableStream({
					start(c) {
						for (const ch of textChunks(text)) c.enqueue(ch);
						c.close();
					},
				}) as never,
			};
		},
	});

/** Providers with credentials are the keys of `models`; each resolves to its own model. */
function runtime(
	models: Partial<Record<AiProviderName, MockLanguageModelV4>>,
	chat?: AiSelection,
): AiRuntime {
	return {
		available: async () => AI_PROVIDERS.filter((p) => models[p]),
		resolve: async (selection) => {
			const model = models[selection.provider];
			return model
				? { ok: true, model, providerOptions: {}, selection }
				: { ok: false, reason: "unavailable" };
		},
		envDefaults: { chat },
		maxSteps: 4,
		temperature: undefined,
		reasoning: undefined,
	};
}

const deps = (ai: AiRuntime): ChatDeps => ({
	db: t.db,
	ai,
	log: { warn() {}, error() {} },
});

/** Sends a turn (or a retry without `message`) and reads the reply to its end. */
async function send(ai: AiRuntime, conversationId: string, message?: string) {
	const r = await startChat(deps(ai), { conversationId, message });
	if (r.status !== "ok") throw new Error(r.status);
	await r.response.text();
}

/** The last stored message once it is an assistant reply that finished. */
const lastReply = (conversationId: string) =>
	waitFor(
		async () => {
			const last = (await getConversation(t.db, conversationId))?.messages.at(
				-1,
			);
			return last?.role === "assistant" && last.finishReason ? last : null;
		},
		{ what: "a stored reply" },
	);

const GPT = { provider: "openai", model: "gpt-mid" } as const;
const CLAUDE = { provider: "anthropic", model: "claude-high" } as const;

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
});

describe("conversation model", () => {
	const newConversation = (model?: AiSelection) =>
		createConversation(t.db, { editionIds: [readyId], model }).then(
			(c) => c.id,
		);

	afterEach(async () => {
		await resetChatDefault(t.db);
	});

	it("uses the conversation's own model and records it on the reply and its usage", async () => {
		const gpt = replying("From GPT.");
		const claude = replying("From Claude.");
		const ai = runtime({ openai: gpt, anthropic: claude }, GPT);
		const own = await newConversation(CLAUDE);
		const other = await newConversation();

		await send(ai, own, "Hello?");
		expect(await lastReply(own)).toMatchObject({
			provider: "anthropic",
			model: "claude-high",
		});
		const [usage] = await waitFor(() =>
			t.db.select().from(aiUsage).where(eq(aiUsage.conversationId, own)),
		);
		expect(usage).toMatchObject({
			provider: "anthropic",
			model: "claude-high",
		});
		expect(claude.doStreamCalls).toHaveLength(1);
		expect(gpt.doStreamCalls).toHaveLength(0);

		// Another conversation keeps following the default.
		await send(ai, other, "Hello?");
		expect(await lastReply(other)).toMatchObject({
			provider: "openai",
			model: "gpt-mid",
		});
		expect(gpt.doStreamCalls).toHaveLength(1);
	});

	it("follows the chat default as it changes", async () => {
		const gpt = replying("From GPT.");
		const claude = replying("From Claude.");
		const ai = runtime({ openai: gpt, anthropic: claude }, GPT);
		const id = await newConversation();

		await send(ai, id, "one");
		expect((await lastReply(id)).model).toBe("gpt-mid");
		expect(await saveChatDefault(t.db, ai, CLAUDE)).toMatchObject({
			status: "ok",
		});
		await send(ai, id, "two");
		const conversation = await waitFor(async () => {
			const c = await getConversation(t.db, id);
			return c && c.messages.length === 4 ? c : null;
		});
		// Earlier replies keep the model that produced them.
		expect(
			conversation.messages
				.filter((m) => m.role === "assistant")
				.map((m) => [m.provider, m.model]),
		).toEqual([
			["openai", "gpt-mid"],
			["anthropic", "claude-high"],
		]);
	});

	it("refuses a turn whose model is unavailable, storing nothing and calling no model", async () => {
		const gpt = replying("From GPT.");
		const ai = runtime({ openai: gpt }, GPT);
		const own = await newConversation(CLAUDE);
		expect(
			await startChat(deps(ai), { conversationId: own, message: "Hello?" }),
		).toEqual({ status: "model_unavailable", selection: CLAUDE });
		expect((await getConversation(t.db, own))?.messages).toEqual([]);

		// A saved default whose provider lost its credentials is not replaced either.
		await saveChatDefault(t.db, runtime({ anthropic: gpt }), CLAUDE);
		const follows = await newConversation();
		expect(
			await startChat(deps(ai), { conversationId: follows, message: "Hi" }),
		).toEqual({ status: "model_unavailable", selection: CLAUDE });
		expect((await getConversation(t.db, follows))?.messages).toEqual([]);
		expect(gpt.doStreamCalls).toHaveLength(0);
	});

	it("reports disabled when no model applies", async () => {
		const id = await newConversation();
		const result = await startChat(deps(runtime({ openai: replying("x") })), {
			conversationId: id,
			message: "Hi",
		});
		expect(result.status).toBe("disabled");
		expect((await getConversation(t.db, id))?.messages).toEqual([]);
	});

	it("retries with the model in effect when the retry starts", async () => {
		const failing = new MockLanguageModelV4({
			doStream: async () => {
				throw new APICallError({
					message: "upstream exploded",
					url: "https://example.test",
					requestBodyValues: {},
					statusCode: 500,
					isRetryable: false,
				});
			},
		});
		const claude = replying("Recovered.");
		const ai = runtime({ openai: failing, anthropic: claude }, GPT);
		const id = await newConversation();

		await send(ai, id, "Hello?");
		expect(await lastReply(id)).toMatchObject({
			finishReason: "error",
			provider: "openai",
		});
		expect(await setConversationModel({ db: t.db, ai }, id, CLAUDE)).toEqual({
			status: "ok",
			selection: CLAUDE,
		});
		await send(ai, id);
		const reply = await waitFor(async () => {
			const last = (await getConversation(t.db, id))?.messages.at(-1);
			return last?.finishReason === "stop" ? last : null;
		});
		expect(reply).toMatchObject({
			provider: "anthropic",
			model: "claude-high",
		});
		expect(JSON.stringify(claude.doStreamCalls[0]?.prompt)).toContain("Hello?");
	});
});

describe("setConversationModel", () => {
	const ai = runtime({ openai: replying("x"), anthropic: replying("y") }, GPT);

	it("sets and clears a conversation's model", async () => {
		const { id } = await createConversation(t.db, { editionIds: [readyId] });
		expect(
			await setConversationModel({ db: t.db, ai }, id, {
				provider: "anthropic",
				model: "  claude-high  ",
			}),
		).toEqual({ status: "ok", selection: CLAUDE });
		expect((await getConversation(t.db, id))?.model).toEqual(CLAUDE);

		expect(await setConversationModel({ db: t.db, ai }, id, null)).toEqual({
			status: "ok",
			selection: null,
		});
		expect((await getConversation(t.db, id))?.model).toBeNull();
	});

	it("rejects an unavailable provider, an invalid id, and a missing conversation", async () => {
		const { id } = await createConversation(t.db, {
			editionIds: [readyId],
			model: GPT,
		});
		expect(
			await setConversationModel({ db: t.db, ai }, id, {
				provider: "google",
				model: "gemini",
			}),
		).toEqual({ status: "unavailable", provider: "google" });
		expect(
			await setConversationModel({ db: t.db, ai }, id, {
				provider: "openai",
				model: "   ",
			}),
		).toMatchObject({ status: "invalid" });
		expect((await getConversation(t.db, id))?.model).toEqual(GPT);
		expect(
			await setConversationModel(
				{ db: t.db, ai },
				"00000000-0000-0000-0000-000000000000",
				GPT,
			),
		).toEqual({ status: "not_found" });
	});

	it("refuses while a reply is being generated, which keeps its model", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const slow = replying("Slow.", gate);
		const busyAi = runtime({ openai: slow, anthropic: replying("y") }, GPT);
		const { id } = await createConversation(t.db, { editionIds: [readyId] });
		const r = await startChat(deps(busyAi), {
			conversationId: id,
			message: "First",
		});
		if (r.status !== "ok") throw new Error(r.status);
		const body = r.response.text();

		for (const selection of [CLAUDE, null]) {
			expect(
				await setConversationModel({ db: t.db, ai: busyAi }, id, selection),
			).toEqual({ status: "busy" });
		}
		release();
		await body;
		expect(await lastReply(id)).toMatchObject({ model: "gpt-mid" });
		expect((await getConversation(t.db, id))?.model).toBeNull();
		// Allowed again once the reply is stored.
		expect(
			await setConversationModel({ db: t.db, ai: busyAi }, id, CLAUDE),
		).toEqual({ status: "ok", selection: CLAUDE });
	});

	it("starts a conversation with its own model", async () => {
		const created = await createConversationForEdition(
			t.db,
			readyId,
			{ kind: "whole" },
			CLAUDE,
		);
		if (!created || "error" in created)
			throw new Error("expected a conversation");
		expect((await getConversation(t.db, created.id))?.model).toEqual(CLAUDE);
	});
});
