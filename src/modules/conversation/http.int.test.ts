import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createSession,
	LoginRateLimiter,
	setupPassword,
} from "#/modules/access";
import type { AiRuntime } from "#/modules/ai";
import { loadConfig } from "#/server/config";
import { handleRequest } from "#/server/request";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { ingestBook, silentLog, tempDataDir } from "../../../test/library";
import { waitFor } from "../../../test/wait";
import { createConversation, getConversation, handleChatRequest } from ".";

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

const enabled = (model: MockLanguageModelV4): AiRuntime => ({
	model,
	status: { enabled: true, provider: "openai", model: "mock" },
	maxSteps: 4,
	preprocessModel: null,
	temperature: undefined,
	reasoning: undefined,
	providerOptions: {},
});
const disabled: AiRuntime = {
	model: null,
	status: { enabled: false },
	preprocessModel: null,
	maxSteps: 8,
	temperature: undefined,
	reasoning: undefined,
	providerOptions: {},
};

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
