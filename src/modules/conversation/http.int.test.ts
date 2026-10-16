import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createSession,
	LoginRateLimiter,
	setupPassword,
} from "#/modules/access";
import { type AiRuntime, createAi } from "#/modules/ai";
import { loadConfig } from "#/server/config";
import { handleRequest } from "#/server/request";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { ingestBook, silentLog, tempDataDir } from "../../../test/library";
import { waitFor } from "../../../test/wait";
import {
	appendMessage,
	createConversation,
	getConversation,
	handleChatRequest,
} from ".";

let t: TestDb;
let editionId: string;

const config = loadConfig({ DATABASE_URL: "postgres://unused" });
const usage = {
	inputTokens: {
		total: 1,
		noCache: 1,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function modelWith(
	parts: () => Record<string, unknown>[],
	gate?: Promise<void>,
): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doStream: async () => ({
			stream: new ReadableStream({
				async start(c) {
					c.enqueue({ type: "stream-start", warnings: [] });
					c.enqueue({ type: "text-start", id: "t1" });
					for (const p of parts()) c.enqueue(p);
					if (gate) await gate;
					c.enqueue({ type: "text-end", id: "t1" });
					c.enqueue({
						type: "finish",
						finishReason: { unified: "stop", raw: undefined },
						usage,
					});
					c.close();
				},
			}) as never,
		}),
	});
}

const enabled = (model: MockLanguageModelV4): AiRuntime => {
	const chat = { provider: "openai", model: "mock" } as const;
	return {
		available: () => ["openai"],
		resolve: (selection) => ({
			ok: true,
			model,
			providerOptions: {},
			selection,
		}),
		envDefaults: { chat },
		maxSteps: 4,
		temperature: undefined,
		reasoning: undefined,
	};
};
const disabled = createAi(undefined);

const post = (body: unknown, headers: Record<string, string> = {}) =>
	new Request("http://books.local/api/chat", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});

const chat = (ai: AiRuntime, request: Request) =>
	handleChatRequest(request, {
		db: t.db,
		ai,
		log: { warn() {}, error() {} },
	});

const newConversation = () =>
	createConversation(t.db, { editionIds: [editionId] }).then((c) => c.id);

beforeAll(async () => {
	t = await createTestDb();
	const book = await ingestBook(
		t.db,
		await tempDataDir(),
		await buildEpub({
			title: "Route Book",
			language: "en",
			chapters: [{ href: "a.xhtml", body: "<p>Some text.</p>" }],
		}),
		"route.epub",
	);
	editionId = book.id;
});

describe("POST /api/chat", () => {
	it("returns 503 when AI is disabled and stores nothing", async () => {
		const id = await newConversation();
		const res = await chat(
			disabled,
			post({ conversationId: id, message: "hi" }),
		);
		expect(res.status).toBe(503);
		expect((await getConversation(t.db, id))?.messages).toEqual([]);
	});

	it("returns 503 naming the model when the conversation's model is unavailable", async () => {
		const model = modelWith(() => []);
		const { id } = await createConversation(t.db, {
			editionIds: [editionId],
			model: { provider: "google", model: "gemini-pro" },
		});
		const ai: AiRuntime = {
			...enabled(model),
			resolve: () => ({ ok: false, reason: "unavailable" }),
		};
		const res = await chat(ai, post({ conversationId: id, message: "hi" }));
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({
			error: "Model google/gemini-pro is unavailable",
			selection: { provider: "google", model: "gemini-pro" },
		});
		expect((await getConversation(t.db, id))?.messages).toEqual([]);
		expect(model.doStreamCalls).toHaveLength(0);
	});

	it("returns 404 for an unknown conversation", async () => {
		const model = modelWith(() => []);
		const res = await chat(
			enabled(model),
			post({
				conversationId: "00000000-0000-0000-0000-000000000000",
				message: "hi",
			}),
		);
		expect(res.status).toBe(404);
		expect(model.doStreamCalls).toHaveLength(0);
	});

	it("returns 400 for malformed bodies", async () => {
		const model = modelWith(() => []);
		const id = await newConversation();
		for (const body of [
			null,
			{},
			{ conversationId: "not-a-uuid", message: "x" },
			{ conversationId: id, message: "   " },
			{ conversationId: id, message: "x".repeat(9000) },
		]) {
			const res = await chat(enabled(model), post(body));
			expect(res.status).toBe(400);
		}
		const raw = new Request("http://books.local/api/chat", {
			method: "POST",
			body: "{nope",
		});
		expect((await chat(enabled(model), raw)).status).toBe(400);
		expect(model.doStreamCalls).toHaveLength(0);
		expect((await getConversation(t.db, id))?.messages).toEqual([]);
	});

	it("returns 409 for a concurrent generation and leaves the conversation alone", async () => {
		const id = await newConversation();
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const slow = modelWith(
			() => [{ type: "text-delta", id: "t1", delta: "Working" }],
			gate,
		);
		const first = await chat(
			enabled(slow),
			post({ conversationId: id, message: "one" }),
		);
		expect(first.status).toBe(200);
		const second = await chat(
			enabled(modelWith(() => [])),
			post({ conversationId: id, message: "two" }),
		);
		expect(second.status).toBe(409);
		release();
		await first.text();
		const conv = await waitFor(async () => {
			const c = await getConversation(t.db, id);
			return c && c.messages.length === 2 ? c : null;
		});
		expect(JSON.stringify(conv.messages[0]?.parts)).toContain("one");
		expect(JSON.stringify(conv.messages)).not.toContain("two");
	});

	it("stores the reader's message exactly as typed", async () => {
		const id = await newConversation();
		const message = "    indented code\nmore prose\n";
		const model = modelWith(() => [
			{ type: "text-delta", id: "t1", delta: "ok" },
		]);
		const res = await chat(
			enabled(model),
			post({ conversationId: id, message }),
		);
		expect(res.status).toBe(200);
		await res.text();
		const stored = (await getConversation(t.db, id))?.messages[0];
		expect(stored?.parts).toEqual([{ type: "text", text: message }]);
	});

	it("streams incrementally, before the model finishes", async () => {
		const id = await newConversation();
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const model = modelWith(
			() => [{ type: "text-delta", id: "t1", delta: "First words" }],
			gate,
		);
		const res = await chat(
			enabled(model),
			post({ conversationId: id, message: "go" }),
		);
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		const reader =
			res.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;
		const decoder = new TextDecoder();
		let seen = "";
		while (!seen.includes("First words")) {
			const { value, done } = await reader.read();
			if (done) throw new Error("stream ended before the text arrived");
			seen += decoder.decode(value);
		}
		// The model is still blocked on the gate: the text arrived mid-generation.
		expect(seen).not.toContain('"type":"finish"');
		release();
		let rest = "";
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			rest += decoder.decode(value);
		}
		expect(rest).toContain('"type":"finish"');
	});
});

describe("chat endpoint access control", () => {
	it("rejects an unauthenticated request without storing anything or calling the model", async () => {
		const id = await newConversation();
		const model = modelWith(() => [
			{ type: "text-delta", id: "t1", delta: "x" },
		]);
		const access = {
			db: t.db,
			password: await setupPassword(t.db, "open sesame", silentLog),
			limiter: new LoginRateLimiter(),
			sessionDays: 30,
			trustProxy: false,
			publicUrl: undefined,
		};
		const app = (request: Request) => chat(enabled(model), request);
		const body = { conversationId: id, message: "sneaky" };

		const anonymous = await handleRequest(post(body), { config, access }, app);
		expect(anonymous.status).toBe(401);
		const forged = await handleRequest(
			post(body, { cookie: "marginalia_session=forged" }),
			{ config, access },
			app,
		);
		expect(forged.status).toBe(401);
		expect(model.doStreamCalls).toHaveLength(0);
		expect((await getConversation(t.db, id))?.messages).toEqual([]);

		const { token } = await createSession(t.db, 1);
		const ok = await handleRequest(
			post(body, { cookie: `marginalia_session=${token}` }),
			{ config, access },
			app,
		);
		expect(ok.status).toBe(200);
		await ok.text();
		expect(model.doStreamCalls).toHaveLength(1);
	});

	it("rejects a cross-origin post", async () => {
		const id = await newConversation();
		const model = modelWith(() => []);
		const access = {
			db: t.db,
			password: { enabled: false } as const,
			limiter: new LoginRateLimiter(),
			sessionDays: 30,
			trustProxy: false,
			publicUrl: undefined,
		};
		const res = await handleRequest(
			post(
				{ conversationId: id, message: "hi" },
				{ origin: "https://evil.example" },
			),
			{ config, access },
			(request) => chat(enabled(model), request),
		);
		expect(res.status).toBe(403);
		expect(model.doStreamCalls).toHaveLength(0);
	});
});

describe("assistant-response context", () => {
	it("rejects malformed contexts without writes or provider calls", async () => {
		const id = await newConversation();
		const model = modelWith(() => [
			{ type: "text-delta", id: "t1", delta: "Answer" },
		]);
		const source = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [{ type: "text", text: "saved" }],
		});
		for (const replyContext of [
			{ messageId: "bad", text: "x" },
			{ messageId: source.id, text: " " },
			{ messageId: source.id, text: "x".repeat(2001) },
		]) {
			expect(
				(
					await chat(
						enabled(model),
						post({ conversationId: id, message: "why", replyContext }),
					)
				).status,
			).toBe(400);
		}
		expect(
			(
				await chat(
					enabled(model),
					post({
						conversationId: id,
						replyContext: { messageId: source.id, text: "quote" },
					}),
				)
			).status,
		).toBe(400);
		expect(model.doStreamCalls).toHaveLength(0);
		expect(
			(await getConversation(t.db, id))?.messages.map((m) => m.id),
		).toEqual([source.id]);

		const res = await chat(
			enabled(model),
			post({
				conversationId: id,
				message: "why",
				replyContext: { messageId: source.id, text: "x".repeat(2000) },
			}),
		);
		expect(res.status).toBe(200);
		await res.text();
		expect(model.doStreamCalls).toHaveLength(1);
	});
	it("validates source membership and accepts saved incomplete responses", async () => {
		const id = await newConversation();
		const foreign = await newConversation();
		const model = modelWith(() => [
			{ type: "text-delta", id: "t1", delta: "Answer" },
		]);
		const user = await appendMessage(t.db, {
			conversationId: id,
			role: "user",
			parts: [{ type: "text", text: "first" }],
		});
		const other = await appendMessage(t.db, {
			conversationId: foreign,
			role: "assistant",
			parts: [{ type: "text", text: "foreign" }],
		});
		for (const messageId of [
			user.id,
			other.id,
			"11111111-1111-4111-8111-111111111111",
		])
			expect(
				(
					await chat(
						enabled(model),
						post({
							conversationId: id,
							message: "why",
							replyContext: { messageId, text: "quote" },
						}),
					)
				).status,
			).toBe(400);
		expect(model.doStreamCalls).toHaveLength(0);
		expect((await getConversation(t.db, id))?.messages).toHaveLength(1);
		const source = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [{ type: "text", text: "partial" }],
			finishReason: "aborted",
		});
		const res = await chat(
			enabled(model),
			post({
				conversationId: id,
				message: "why",
				replyContext: { messageId: source.id, text: " partial " },
			}),
		);
		expect(res.status).toBe(200);
		await res.text();
		const stored = await waitFor(
			async () => {
				const c = await getConversation(t.db, id);
				return c?.messages.length === 4 ? c : null;
			},
			{ what: "quoted response" },
		);
		expect(stored.messages[2]?.parts).toEqual([
			{
				type: "data-reply-context",
				data: { version: 1, messageId: source.id, text: "partial" },
			},
			{ type: "text", text: "why" },
		]);
		expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(
			"not verified book evidence",
		);
	});
});

describe("passage references", () => {
	const firstLocator = async () => {
		const id = await newConversation();
		return `${(await getConversation(t.db, id))?.books[0]?.shortId}:v1:0.0`;
	};

	it("rejects invalid and out-of-scope references without writes or provider calls", async () => {
		const locator = await firstLocator();
		const model = modelWith(() => [
			{ type: "text-delta", id: "t1", delta: "Answer" },
		]);
		const id = await newConversation();
		const bounded = (
			await createConversation(t.db, {
				editionIds: [editionId],
				scopes: { [editionId]: { maxPosition: 0, scopeLabel: "Nothing" } },
			})
		).id;
		const cases: [string, Record<string, unknown>, number][] = [
			[id, { message: "why", passageRef: { locator: "nonsense" } }, 400],
			[id, { passageRef: { locator } }, 400],
			[
				id,
				{
					message: "why",
					passageRef: { locator },
					replyContext: {
						messageId: "11111111-1111-4111-8111-111111111111",
						text: "q",
					},
				},
				400,
			],
			[id, { message: "why", passageRef: { locator: `${locator}9` } }, 400],
			[
				id,
				{
					message: "why",
					passageRef: { locator, range: { start: 0, end: 999 } },
				},
				400,
			],
			[bounded, { message: "why", passageRef: { locator } }, 409],
		];
		for (const [conversationId, body, status] of cases) {
			const res = await chat(enabled(model), post({ conversationId, ...body }));
			expect(res.status).toBe(status);
			if (status === 409)
				expect(await res.json()).toMatchObject({
					error: "The passage is beyond this conversation's scope",
					unitLabel: expect.any(String),
				});
		}
		expect(model.doStreamCalls).toHaveLength(0);
		expect((await getConversation(t.db, id))?.messages).toEqual([]);
		expect((await getConversation(t.db, bounded))?.messages).toEqual([]);
	});

	it("stores the server's snapshot with the message", async () => {
		const locator = await firstLocator();
		const model = modelWith(() => [
			{ type: "text-delta", id: "t1", delta: "Answer" },
		]);
		const id = await newConversation();
		const res = await chat(
			enabled(model),
			post({
				conversationId: id,
				message: "why",
				passageRef: { locator, range: { start: 0, end: 4 } },
			}),
		);
		expect(res.status).toBe(200);
		await res.text();
		const stored = await waitFor(
			async () => {
				const c = await getConversation(t.db, id);
				return c?.messages.length === 2 ? c : null;
			},
			{ what: "referenced message" },
		);
		expect(stored.messages[0]?.parts).toEqual([
			{
				type: "data-passage-context",
				data: {
					version: 1,
					locator,
					range: { start: 0, end: 4 },
					editionId,
					bookTitle: "Route Book",
					sectionTitle: null,
					text: "Some",
				},
			},
			{ type: "text", text: "why" },
		]);
	});
});
