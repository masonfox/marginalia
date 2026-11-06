import { type ChildProcess, fork } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureEdition } from "#/modules/library";
import { JobRuntime } from "#/server/jobs";
import { createTestDb, type TestDb } from "../../../test/db";
import { sleep, waitFor } from "../../../test/wait";
import { appendMessage, createConversation } from "./repository";
import { conversations } from "./schema";

let t: TestDb;
let editionId: string;
let web: JobRuntime;
let calls = 0;
let concurrent = 0;
let maxConcurrent = 0;
const release: (() => void)[] = [];
let providerUrl = "";
const children: ChildProcess[] = [];
const log = pino({ level: "silent" });
const provider = createServer(async (req, res) => {
	for await (const _ of req) {
		/* Drain the request. */
	}
	calls++;
	concurrent++;
	maxConcurrent = Math.max(maxConcurrent, concurrent);
	release.push(() => {
		concurrent--;
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({
				content: [{ type: "text", text: "The Opening Question Subject" }],
				finishReason: { unified: "stop" },
				usage: { inputTokens: { total: 10 }, outputTokens: { total: 3 } },
				warnings: [],
			}),
		);
	});
});
beforeAll(async () => {
	t = await createTestDb();
	editionId = (await ensureEdition(t.db, "title-process", "Book")).edition.id;
	await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
	const address = provider.address();
	if (!address || typeof address === "string") throw new Error("No provider");
	providerUrl = `http://127.0.0.1:${address.port}`;
	return async () => {
		await new Promise<void>((r) => provider.close(() => r()));
	};
});
afterEach(async () => {
	release.splice(0).forEach((f) => {
		f();
	});
	for (const child of children.splice(0)) {
		if (child.exitCode === null) {
			child.kill();
			await new Promise<void>((r) => child.once("exit", () => r()));
		}
	}
	if (web) await web.stop(1000);
	await t.pool.query("delete from conversations");
	calls = 0;
	concurrent = 0;
	maxConcurrent = 0;
});
async function producer() {
	web = await JobRuntime.start({
		connectionString: t.url,
		config: { ingestConcurrency: 1 },
		log,
		worker: false,
		handlers: {},
	});
	return web;
}
async function worker(crash = "") {
	const child = fork(path.resolve("test/title-worker.ts"), [], {
		execArgv: ["--import", "tsx"],
		windowsHide: true,
		env: {
			...process.env,
			TITLE_TEST_DATABASE_URL: t.url,
			TITLE_TEST_PROVIDER_URL: providerUrl,
			TITLE_TEST_CRASH: crash,
		},
		silent: true,
	});
	children.push(child);
	let output = "";
	child.stderr?.on("data", (d) => {
		output += String(d);
	});
	let ready = false;
	child.on("message", (msg) => {
		if (msg === "ready") ready = true;
	});
	await waitFor(
		() => {
			if (child.exitCode !== null)
				throw new Error(`Worker exited ${child.exitCode}: ${output}`);
			return ready;
		},
		{ what: "worker ready" },
	);
	return child;
}
const pending = async () => {
	const { id } = await createConversation(t.db, { editionIds: [editionId] });
	await appendMessage(t.db, {
		conversationId: id,
		role: "user",
		parts: [{ type: "text", text: "What is the question's subject?" }],
		namingSelection: { provider: "openai", model: "captured" },
	});
	return id;
};
const state = async (id: string) =>
	(await t.db.select().from(conversations).where(eq(conversations.id, id)))[0]
		?.namingState;
describe("separate web/worker and restart boundaries", () => {
	it("web-only enqueue deduplicates and startup dispatcher recovers commit/send gaps with concurrency two", async () => {
		await producer();
		const ids = await Promise.all(Array.from({ length: 5 }, pending));
		const job = await web.enqueue("conversation.title", {
			conversationId: ids[0],
		});
		expect(job).toBeTruthy();
		expect(
			await web.enqueue("conversation.title", { conversationId: ids[0] }),
		).toBeNull();
		expect(calls).toBe(0);
		await worker();
		await waitFor(() => calls === 2);
		expect(maxConcurrent).toBe(2);
		await sleep(500);
		expect(calls).toBe(2);
		const queued = await t.db
			.select()
			.from(conversations)
			.where(eq(conversations.namingState, "pending"));
		const expiredId = queued[0].id;
		await t.db
			.update(conversations)
			.set({ namingExpiresAt: new Date(0) })
			.where(eq(conversations.id, expiredId));
		release.splice(0).forEach((f) => {
			f();
		});
		await waitFor(() => calls === 4);
		expect(maxConcurrent).toBe(2);
		release.splice(0).forEach((f) => {
			f();
		});
		await waitFor(async () => (await state(expiredId)) === "failed");
		expect(calls).toBe(4);
	});
	it.each([
		"claimed",
		"result",
	])("pg-boss redelivery after a crash at %s does not invoke the provider again", async (crash) => {
		await producer();
		const child = await worker(crash);
		const id = await pending();
		const jobId = await web.enqueue("conversation.title", {
			conversationId: id,
		});
		if (crash === "result") {
			await waitFor(() => calls === 1);
			release.splice(0).forEach((f) => {
				f();
			});
		}
		await waitFor(() => child.exitCode !== null);
		expect(child.exitCode).toBe(crash === "claimed" ? 91 : 92);
		expect(await state(id)).toBe("running");
		await web.boss.fail("conversation.title", jobId as string);
		await worker();
		await waitFor(
			async () =>
				(await web.boss.findJobs("conversation.title")).find(
					(j) => j.id === jobId,
				)?.state === "completed",
		);
		expect(calls).toBe(crash === "claimed" ? 0 : 1);
		await t.db
			.update(conversations)
			.set({ namingDeadline: new Date(0) })
			.where(eq(conversations.id, id));
		await web.enqueue("conversation.dispatch-titles", {});
		await waitFor(async () => (await state(id)) === "failed");
		expect(calls).toBe(crash === "claimed" ? 0 : 1);
	});
	it("restarts pending work but leaves historical and expired rows without AI calls", async () => {
		await producer();
		const good = await pending();
		const expired = await pending();
		await t.db
			.update(conversations)
			.set({ namingExpiresAt: new Date(0) })
			.where(eq(conversations.id, expired));
		const historical = await createConversation(t.db, {
			editionIds: [editionId],
		});
		await t.db
			.update(conversations)
			.set({ namingState: "ineligible" })
			.where(eq(conversations.id, historical.id));
		await worker();
		await waitFor(() => calls === 1);
		release.splice(0).forEach((f) => {
			f();
		});
		await waitFor(async () => (await state(good)) === "succeeded");
		expect(await state(expired)).toBe("failed");
		expect(await state(historical.id)).toBe("ineligible");
		expect(calls).toBe(1);
	});
});

it("dispatcher batches at most 100 pending rows and rejects no historical rows", async () => {
	const { randomUUID } = await import("node:crypto");
	const { dispatchTitles } = await import("./title");
	await producer();
	const ids = Array.from({ length: 103 }, () => randomUUID());
	await t.db.insert(conversations).values(
		ids.map((id) => ({
			id,
			title: "Provisional",
			namingState: "pending" as const,
			namingMessageId: randomUUID(),
			namingProvider: "openai" as const,
			namingModel: "captured",
			namingExpiresAt: new Date(Date.now() + 60_000),
		})),
	);
	let enqueued = 0;
	await dispatchTitles({
		db: t.db,
		enqueue: async () => {
			enqueued++;
			return null;
		},
	});
	expect(enqueued).toBe(100);
	expect(calls).toBe(0);
});
