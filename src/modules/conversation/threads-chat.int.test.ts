import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, describe, expect, it } from "vitest";
import type { AiRuntime } from "#/modules/ai";
import { priceTable, totalOf, usageForConversation } from "#/modules/usage";
import type { Database } from "#/server/db";
import { createTestDb, type TestDb } from "../../../test/db";
import { buildEpub } from "../../../test/epub-builder";
import { ingestBook, tempDataDir } from "../../../test/library";
import { waitFor } from "../../../test/wait";
import {
	appendMessage,
	type ChatDeps,
	type ChatInput,
	createConversation,
	createThreadWithMessage,
	getConversation,
	getConversationWithUsage,
	getThreadMessages,
	getThreadWithUsage,
	handleChatRequest,
	listThreads,
	startChat,
	THREAD_ID_HEADER,
} from ".";
import { messages } from "./schema";

let t: TestDb;
let editionId: string;

const usage = {
	inputTokens: {
		total: 10,
		noCache: 10,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 2, text: 2, reasoning: undefined },
};
type Chunk = Record<string, unknown>;
const textReply = (text: string): Chunk[] => [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t1" },
	{ type: "text-delta", id: "t1", delta: text },
	{ type: "text-end", id: "t1" },
	{ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
];
/** A step that finishes and reports usage, then a failing step. */
const failingReply: Chunk[][] = [
	[
		{ type: "stream-start", warnings: [] },
		{
			type: "tool-call",
			toolCallId: "c1",
			toolName: "searchBooks",
			input: JSON.stringify({ query: "light" }),
		},
		{
			type: "finish",
			finishReason: { unified: "tool-calls", raw: undefined },
			usage,
		},
	],
	[
		{ type: "stream-start", warnings: [] },
		{ type: "error", error: new Error("overloaded") },
	],
];

/** A model that plays the scripted responses in order, repeating the last; `gate` holds the first reply open. */
function scripted(responses: Chunk[][], gate?: Promise<void>) {
	let i = 0;
	return new MockLanguageModelV4({
		doStream: async () => {
			const n = i++;
			const chunks = responses[Math.min(n, responses.length - 1)] as Chunk[];
			return {
				stream: new ReadableStream({
					async start(c) {
						for (const [k, ch] of chunks.entries()) {
							if (n === 0 && gate && k === chunks.length - 1) await gate;
							c.enqueue(ch);
						}
						c.close();
					},
				}) as never,
			};
		},
	});
}

/**
 * Wraps a database so the quote-source read (`select { id } from messages`)
 * waits until `n` reads have reached it, or until `open` is called: a send
 * that settles without reaching it opens the barrier rather than deadlocking.
 */
function quoteReadBarrier(db: Database, n: number) {
	let arrived = 0;
	let open = () => {};
	const opened = new Promise<void>((r) => {
		open = r;
	});
	const wrapped = new Proxy(db, {
		get(target, prop) {
			const value = Reflect.get(target, prop, target);
			if (prop !== "select")
				return typeof value === "function" ? value.bind(target) : value;
			return (fields?: Record<string, unknown>) => {
				const builder = target.select(fields as never);
				if (
					!fields ||
					Object.keys(fields).length !== 1 ||
					fields.id !== messages.id
				)
					return builder;
				return {
					from: (table: typeof messages) => {
						const from = builder.from(table);
						return {
							where: (cond: Parameters<typeof from.where>[0]) => {
								const query = from.where(cond);
								if (++arrived >= n) open();
								return opened.then(() => query);
							},
						};
					},
				};
			};
		},
	});
	return { db: wrapped, open: () => open(), arrived: () => arrived };
}

const runtime = (model: MockLanguageModelV4): AiRuntime => ({
	available: async () => ["openai"],
	resolve: async (selection) => ({
		ok: true,
		model,
		providerOptions: {},
		selection,
	}),
	maxSteps: 5,
	temperature: undefined,
	reasoning: undefined,
});

const deps = (ai: AiRuntime): ChatDeps => ({
	db: t.db,
	ai,
	log: { warn() {}, error() {} },
});

const newConversation = async () =>
	(await createConversation(t.db, { editionIds: [editionId] })).id;

async function send(ai: AiRuntime, input: ChatInput) {
	const r = await startChat(deps(ai), input);
	if (r.status !== "ok") throw new Error(r.status);
	return r.response;
}

async function readChunks(response: Response) {
	return (await response.text())
		.split("\n")
		.filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
		.map(
			(l) => JSON.parse(l.slice(6)) as { type: string; [k: string]: unknown },
		);
}

const mainCount = (id: string, count: number) =>
	waitFor(
		async () => {
			const c = await getConversation(t.db, id);
			return c && c.messages.length >= count ? c : null;
		},
		{ what: `${count} main messages` },
	);

const threadCount = (id: string, threadId: string, count: number) =>
	waitFor(
		async () => {
			const d = await getThreadMessages(t.db, id, threadId);
			return d && d.messages.length >= count ? d : null;
		},
		{ what: `${count} thread messages` },
	);

/** A conversation with one main question and a stored answer, made through the chat. */
async function withAnswer(model: MockLanguageModelV4) {
	const id = await newConversation();
	await (
		await send(runtime(model), {
			conversationId: id,
			message: "What is the light?",
		})
	).text();
	const conversation = await mainCount(id, 2);
	return { id, reply: conversation.messages[1]?.id as string };
}

/** Starts a thread through the chat and waits for its reply; returns the thread id. */
async function startThread(
	model: MockLanguageModelV4,
	id: string,
	anchorMessageId: string,
	message = "Why green?",
	quote = "green light",
) {
	const chunks = await readChunks(
		await send(runtime(model), {
			conversationId: id,
			message,
			newThread: { anchorMessageId, quote },
		}),
	);
	const marker = chunks.find((c) => c.type === "data-thread");
	const threadId = (marker?.data as { threadId: string }).threadId;
	await threadCount(id, threadId, 2);
	return threadId;
}

async function counts(id: string) {
	const { rows } = await t.pool.query<{ threads: number; messages: number }>(
		"select (select count(*)::int from conversation_threads where conversation_id = $1) as threads, (select count(*)::int from messages where conversation_id = $1) as messages",
		[id],
	);
	return rows[0];
}

const post = (body: unknown) =>
	new Request("http://books.local/api/chat", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

beforeAll(async () => {
	t = await createTestDb();
	await t.pool.query(
		"insert into ai_settings (id, chat_provider, chat_model) values (1, 'openai', 'mock-1')",
	);
	const book = await ingestBook(
		t.db,
		await tempDataDir(),
		await buildEpub({
			title: "Thread Book",
			language: "en",
			chapters: [
				{
					href: "a.xhtml",
					title: "One",
					body: "<p>The green light burned.</p>",
				},
			],
		}),
		"thread.epub",
	);
	editionId = book.id;
});

describe("chat body (HTTP)", () => {
	it("rejects malformed and conflicting thread bodies with 400, storing nothing and calling no provider", async () => {
		const model = scripted([textReply("The light is hope.")]);
		const { id, reply } = await withAnswer(model);
		const threadId = await startThread(model, id, reply);
		const before = await counts(id);
		const calls = model.doStreamCalls.length;
		const bodies = [
			// Both an existing and a new thread.
			{
				conversationId: id,
				message: "x",
				threadId,
				newThread: { anchorMessageId: reply, quote: "q" },
			},
			// A new thread without a message (a retry).
			{ conversationId: id, newThread: { anchorMessageId: reply, quote: "q" } },
			{
				conversationId: id,
				message: "x",
				newThread: { anchorMessageId: reply, quote: "   " },
			},
			{
				conversationId: id,
				message: "x",
				newThread: { anchorMessageId: reply, quote: "x".repeat(2001) },
			},
			{
				conversationId: id,
				message: "x",
				newThread: { anchorMessageId: "nope", quote: "q" },
			},
			{ conversationId: id, message: "x", newThread: { quote: "q" } },
			{ conversationId: id, message: "x", threadId: "not-a-uuid" },
		];
		for (const body of bodies) {
			const res = await handleChatRequest(post(body), deps(runtime(model)));
			expect(res.status, JSON.stringify(body)).toBe(400);
		}
		expect(await counts(id)).toEqual(before);
		expect(model.doStreamCalls).toHaveLength(calls);
	});

	it("reports the new thread's id in the stream and a header", async () => {
		const model = scripted([textReply("The light is hope.")]);
		const { id, reply } = await withAnswer(model);
		const res = await handleChatRequest(
			post({
				conversationId: id,
				message: "Why green?",
				newThread: { anchorMessageId: reply, quote: "light is hope" },
			}),
			deps(runtime(model)),
		);
		expect(res.status).toBe(200);
		const threadId = res.headers.get(THREAD_ID_HEADER);
		const chunks = await readChunks(res);
		expect(chunks[0]).toEqual({
			type: "data-thread",
			data: { threadId },
			transient: true,
		});
		const [thread] = await listThreads(t.db, id);
		expect(thread).toMatchObject({
			id: threadId,
			anchorMessageId: reply,
			anchorQuote: "light is hope",
		});
		const stored = await threadCount(id, threadId as string, 2);
		expect(stored.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		// The transient marker is not stored with the reply.
		expect(JSON.stringify(stored.messages[1]?.parts)).not.toContain(
			"data-thread",
		);
	});
});

describe("anchor validation", () => {
	it("rejects each invalid anchor or thread without appending, creating a thread, or calling the provider", async () => {
		const model = scripted([textReply("The light is hope.")]);
		const { id, reply } = await withAnswer(model);
		const other = await withAnswer(model);
		const threadId = await startThread(model, id, reply);
		const otherThread = await startThread(model, other.id, other.reply);
		const [question, threadReply] = [
			(await getConversation(t.db, id))?.messages[0]?.id as string,
			(await getThreadMessages(t.db, id, threadId))?.messages[1]?.id as string,
		];
		const errored = await appendMessage(t.db, {
			conversationId: id,
			role: "assistant",
			parts: [{ type: "text", text: "partial" }],
			finishReason: "error",
			error: "boom",
		});
		const before = await counts(id);
		const calls = model.doStreamCalls.length;
		const ai = runtime(model);
		for (const anchorMessageId of [
			question,
			threadReply,
			other.reply,
			errored.id,
			crypto.randomUUID(),
		]) {
			expect(
				await startChat(deps(ai), {
					conversationId: id,
					message: "x",
					newThread: { anchorMessageId, quote: "light" },
				}),
			).toEqual({ status: "invalid_anchor" });
		}
		for (const quote of ["  ", "x".repeat(2001)])
			expect(
				await startChat(deps(ai), {
					conversationId: id,
					message: "x",
					newThread: { anchorMessageId: reply, quote },
				}),
			).toEqual({ status: "invalid_anchor" });
		for (const thread of [otherThread, crypto.randomUUID()])
			expect(
				await startChat(deps(ai), {
					conversationId: id,
					message: "x",
					threadId: thread,
				}),
			).toEqual({ status: "invalid_thread" });
		expect(await counts(id)).toEqual(before);
		expect(model.doStreamCalls).toHaveLength(calls);
		// The HTTP layer reports them as validation errors.
		const res = await handleChatRequest(
			post({
				conversationId: id,
				message: "x",
				newThread: { anchorMessageId: question, quote: "q" },
			}),
			deps(ai),
		);
		expect(res.status).toBe(400);
	});
});

describe("thread history", () => {
	it("sends the main conversation through the anchor, the labelled quote, then the thread; main turns see no thread content", async () => {
		const model = scripted([
			textReply("First answer about hope."),
			textReply("Second main answer."),
			textReply("Thread answer one."),
			textReply("Thread answer two."),
			textReply("Third main answer."),
		]);
		const ai = runtime(model);
		const { id, reply } = await withAnswer(model);
		// The main conversation moves on past the anchor.
		await (
			await send(ai, { conversationId: id, message: "Main follow-up" })
		).text();
		await mainCount(id, 4);
		const threadId = await startThread(
			model,
			id,
			reply,
			"Thread question one",
			"about hope",
		);
		await (
			await send(ai, {
				conversationId: id,
				threadId,
				message: "Thread question two",
			})
		).text();
		await threadCount(id, threadId, 4);
		await (
			await send(ai, { conversationId: id, message: "Main again" })
		).text();
		await mainCount(id, 6);

		const [first, second, thread1, thread2, main3] = model.doStreamCalls;
		if (!first || !second || !thread1 || !thread2 || !main3)
			throw new Error("calls");
		const system = (c: typeof first) =>
			JSON.stringify(c.prompt.filter((m) => m.role === "system"));
		for (const c of [thread1, thread2, main3]) {
			expect(system(c)).toBe(system(first));
			expect(JSON.stringify(c.tools)).toBe(JSON.stringify(first.tools));
		}
		// The main slice through the anchor is byte-identical to what the main conversation sent.
		const throughAnchor = second.prompt.length - 1; // all but "Main follow-up"
		expect(JSON.stringify(thread1.prompt.slice(0, throughAnchor))).toBe(
			JSON.stringify(second.prompt.slice(0, throughAnchor)),
		);
		const thread1Text = JSON.stringify(thread1.prompt);
		expect(thread1Text).not.toContain("Main follow-up");
		expect(thread1Text).not.toContain("Second main answer");
		const anchorMessage = JSON.stringify(thread1.prompt.at(-1));
		expect(anchorMessage).toContain("Side thread about this excerpt");
		expect(anchorMessage).toContain("not verified book evidence");
		expect(anchorMessage).toContain(
			"<thread-anchor-quote>\\nabout hope\\n</thread-anchor-quote>",
		);
		expect(anchorMessage).toContain("Thread question one");
		// Earlier thread turns are replayed unchanged.
		expect(JSON.stringify(thread2.prompt.slice(0, thread1.prompt.length))).toBe(
			JSON.stringify(thread1.prompt),
		);
		// The main conversation never sees the thread.
		const main3Text = JSON.stringify(main3.prompt);
		for (const s of [
			"Thread question",
			"Thread answer",
			"thread-anchor-quote",
			"Side thread",
		])
			expect(main3Text).not.toContain(s);
		expect(JSON.stringify(main3.prompt.slice(0, second.prompt.length))).toBe(
			JSON.stringify(second.prompt),
		);
	});

	it("does not include other threads' messages", async () => {
		const model = scripted([textReply("Answer.")]);
		const { id, reply } = await withAnswer(model);
		await startThread(model, id, reply, "Alpha thread question", "Answer");
		const beta = await startThread(
			model,
			id,
			reply,
			"Beta thread question",
			"Answer",
		);
		await (
			await send(runtime(model), {
				conversationId: id,
				threadId: beta,
				message: "More beta",
			})
		).text();
		const last = JSON.stringify(model.doStreamCalls.at(-1)?.prompt);
		expect(last).toContain("Beta thread question");
		expect(last).not.toContain("Alpha thread question");
	});
});

describe("branch-aware retry", () => {
	it("retries a failed thread reply once in the thread, leaving the main conversation alone", async () => {
		const model = scripted([
			textReply("Main answer."),
			...failingReply,
			textReply("Recovered in thread."),
		]);
		const ai = runtime(model);
		const { id, reply } = await withAnswer(model);
		const threadId = await startThread(model, id, reply, "Thread question");
		const failed = await getThreadMessages(t.db, id, threadId);
		expect(failed?.messages[1]?.finishReason).toBe("error");
		const mainBefore = (await getConversation(t.db, id))?.messages;

		// The main conversation has no failure to retry.
		expect(await startChat(deps(ai), { conversationId: id })).toEqual({
			status: "nothing_to_retry",
		});
		await (await send(ai, { conversationId: id, threadId })).text();
		const retried = await waitFor(
			async () => {
				const d = await getThreadMessages(t.db, id, threadId);
				return d?.messages[1]?.finishReason === "stop" ? d : null;
			},
			{ what: "retried thread reply" },
		);
		expect(retried.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(retried.messages[0]?.id).toBe(failed?.messages[0]?.id);
		expect(
			JSON.stringify(model.doStreamCalls.at(-1)?.prompt).match(
				/Thread question/g,
			),
		).toHaveLength(1);
		expect((await getConversation(t.db, id))?.messages).toEqual(mainBefore);
	});

	it("retries a failed main reply without touching a thread, and offers no retry in the thread", async () => {
		const model = scripted([
			textReply("Main answer."),
			textReply("Thread answer."),
			...failingReply,
			textReply("Recovered in main."),
		]);
		const ai = runtime(model);
		const { id, reply } = await withAnswer(model);
		const threadId = await startThread(model, id, reply);
		await (
			await send(ai, { conversationId: id, message: "Main question two" })
		).text();
		const failed = await mainCount(id, 4);
		expect(failed.messages[3]?.finishReason).toBe("error");
		const threadBefore = (await getThreadMessages(t.db, id, threadId))
			?.messages;

		expect(await startChat(deps(ai), { conversationId: id, threadId })).toEqual(
			{
				status: "nothing_to_retry",
			},
		);
		await (await send(ai, { conversationId: id })).text();
		const retried = await waitFor(
			async () => {
				const c = await getConversation(t.db, id);
				return c?.messages[3]?.finishReason === "stop" ? c : null;
			},
			{ what: "retried main reply" },
		);
		expect(retried.messages.filter((m) => m.role === "user")).toHaveLength(2);
		expect((await getThreadMessages(t.db, id, threadId))?.messages).toEqual(
			threadBefore,
		);
	});
});

describe("branch-aware quotes", () => {
	it("allows a thread reply quote in the thread and in main (Bring to main), and rejects cross-branch quotes in a thread", async () => {
		const model = scripted([textReply("A reply.")]);
		const ai = runtime(model);
		const { id, reply } = await withAnswer(model);
		const alpha = await startThread(model, id, reply);
		const beta = await startThread(model, id, reply);
		const alphaReply = (await getThreadMessages(t.db, id, alpha))?.messages[1]
			?.id as string;
		const before = await counts(id);

		// A thread quote must come from the same thread.
		for (const [threadId, messageId] of [
			[beta, alphaReply],
			[alpha, reply],
		] as const)
			expect(
				await startChat(deps(ai), {
					conversationId: id,
					threadId,
					message: "x",
					replyContext: { messageId, text: "A reply." },
				}),
			).toEqual({ status: "invalid_context" });
		expect(
			await startChat(deps(ai), {
				conversationId: id,
				message: "x",
				newThread: { anchorMessageId: reply, quote: "A reply" },
				replyContext: { messageId: reply, text: "A reply." },
			}),
		).toEqual({ status: "invalid_context" });
		expect(await counts(id)).toEqual(before);

		// Reply inside the same thread.
		await (
			await send(ai, {
				conversationId: id,
				threadId: alpha,
				message: "Same thread",
				replyContext: { messageId: alphaReply, text: "A reply." },
			})
		).text();
		await threadCount(id, alpha, 4);

		// Bring to main: a main message may quote a thread reply.
		await (
			await send(ai, {
				conversationId: id,
				message: "Brought back",
				replyContext: { messageId: alphaReply, text: "A reply." },
			})
		).text();
		const main = await mainCount(id, 4);
		expect(JSON.stringify(main.messages[2]?.parts)).toContain(alphaReply);
		expect(main.quoteSourceThreads).toEqual({ [alphaReply]: alpha });
		expect(main.threadReplies[alphaReply]).toBe(alpha);
	});
});

describe("one generation across threads", () => {
	it("returns busy for a main send while a thread generates, and for a thread send while main generates", async () => {
		const model = scripted([textReply("Answer.")]);
		const { id, reply } = await withAnswer(model);
		let release = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const slow = scripted([textReply("Slow thread answer.")], gate);
		const pending = send(runtime(slow), {
			conversationId: id,
			message: "Thread question",
			newThread: { anchorMessageId: reply, quote: "Answer" },
		});
		const response = await pending;
		const before = await counts(id);
		expect(
			await startChat(deps(runtime(model)), {
				conversationId: id,
				message: "Main",
			}),
		).toEqual({
			status: "busy",
		});
		expect(
			await startChat(deps(runtime(model)), {
				conversationId: id,
				message: "Another thread",
				newThread: { anchorMessageId: reply, quote: "Answer" },
			}),
		).toEqual({ status: "busy" });
		expect(await counts(id)).toEqual(before);
		release();
		const threadId = res(await readChunks(response));
		await threadCount(id, threadId, 2);

		// And the reverse.
		let releaseMain = () => {};
		const mainGate = new Promise<void>((r) => {
			releaseMain = r;
		});
		const mainResponse = await send(
			runtime(scripted([textReply("Slow main.")], mainGate)),
			{
				conversationId: id,
				message: "Main question",
			},
		);
		expect(
			await startChat(deps(runtime(model)), {
				conversationId: id,
				threadId,
				message: "x",
			}),
		).toEqual({ status: "busy" });
		releaseMain();
		await mainResponse.text();
		await mainCount(id, 4);
	});

	it("lets only one of several concurrent quoted sends generate", async () => {
		const model = scripted([textReply("Answer.")]);
		const { id, reply } = await withAnswer(model);
		const before = await counts(id);
		let release = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const slow = scripted([textReply("Slow.")], gate);
		const senders = ["A", "B", "C", "D", "E"];
		// Each send is held at the quote check until all have reached it, so
		// none can claim the conversation before the others are validating.
		const barrier = quoteReadBarrier(t.db, senders.length);
		try {
			const quoted = (message: string) =>
				startChat(
					{ ...deps(runtime(slow)), db: barrier.db },
					{
						conversationId: id,
						message,
						replyContext: { messageId: reply, text: "Answer." },
					},
				).finally(barrier.open);
			const results = await Promise.all(senders.map((m) => quoted(m)));
			expect(barrier.arrived()).toBe(senders.length);
			expect(results.map((r) => r.status).sort()).toEqual([
				"busy",
				"busy",
				"busy",
				"busy",
				"ok",
			]);
			const ok = results.find((r) => r.status === "ok");
			release();
			if (ok?.status === "ok") await ok.response.text();
			await mainCount(id, 4);
			expect(slow.doStreamCalls).toHaveLength(1);
			expect(await counts(id)).toEqual({
				threads: before?.threads,
				messages: (before?.messages ?? 0) + 2,
			});
		} finally {
			barrier.open();
			release();
		}
	});
});

const res = (chunks: { type: string; data?: unknown }[]) =>
	(chunks.find((c) => c.type === "data-thread")?.data as { threadId: string })
		.threadId;

describe("thread usage", () => {
	it("counts a thread reply, including a failed attempt that was retried, in the thread and conversation totals", async () => {
		const model = scripted([
			textReply("Main answer."),
			...failingReply,
			textReply("Recovered in thread."),
		]);
		const { id, reply } = await withAnswer(model);
		const threadId = await startThread(model, id, reply);
		await (await send(runtime(model), { conversationId: id, threadId })).text();
		const retried = await waitFor(
			async () => {
				const d = await getThreadWithUsage(t.db, id, threadId, priceTable());
				return d?.messages[1]?.finishReason === "stop" &&
					d.usageTotal.inputTokens === 20
					? d
					: null;
			},
			{ what: "retried thread usage" },
		);
		const threadReply = retried.messages[1]?.id as string;
		// Failed attempt (10) + retried reply (10); the main reply is not in the thread.
		expect(retried.usageTotal).toMatchObject({
			inputTokens: 20,
			outputTokens: 4,
			missing: 0,
		});
		expect(Object.keys(retried.usage)).toEqual([threadReply]);
		expect(retried.thread).toMatchObject({
			id: threadId,
			anchorMessageId: reply,
		});

		const conversation = await getConversationWithUsage(t.db, id, priceTable());
		// Main reply (10) + both thread attempts (20).
		expect(conversation?.usageTotal).toMatchObject({
			inputTokens: 30,
			outputTokens: 6,
		});
		expect(conversation?.usage[threadReply]).toBeDefined();
		expect(
			totalOf(await usageForConversation(t.db, id), priceTable()).inputTokens,
		).toBe(30);
		expect(conversation?.threads.map((th) => th.id)).toEqual([threadId]);
		// Main messages only.
		expect(conversation?.messages).toHaveLength(2);
	});

	it("returns null for a thread outside the conversation", async () => {
		const model = scripted([textReply("A.")]);
		const { id, reply } = await withAnswer(model);
		const created = await createThreadWithMessage(t.db, {
			conversationId: id,
			anchorMessageId: reply,
			quote: "A",
			message: { role: "user", parts: [{ type: "text", text: "q" }] },
		});
		if (created.status !== "ok") throw new Error(created.status);
		const other = await newConversation();
		expect(
			await getThreadWithUsage(t.db, other, created.threadId, priceTable()),
		).toBeNull();
	});
});
