import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	PostgreSqlContainer,
	type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createConversation } from "../src/modules/conversation";
import { editions, ensureEdition } from "../src/modules/library";
import { aiCredentials } from "../src/modules/settings";
import { createDb, type DbHandle } from "../src/server/db";
import { runMigrations } from "../src/server/db/migrate";

// Self-contained browser checks. Build first, then run with playwright.titles.config.ts.
let container: StartedPostgreSqlContainer;
let handle: DbHandle;
let dataDir: string;
let web: ChildProcess;
let worker: ChildProcess;
let appUrl: string;
let editionId: string;
let mode = "reply-first";
let titleCalls = 0;
const heldTitles: (() => void)[] = [];
const heldReplies: (() => void)[] = [];
let output = "";
const password = "isolated-title-browser-tests";
const secret = Buffer.alloc(32, 7).toString("base64");
const provider = createServer(async (req, res) => {
	if (req.url === "/v1/models") {
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({ data: [{ id: "title-fixture", object: "model" }] }),
		);
		return;
	}
	let body = "";
	for await (const chunk of req) body += chunk;
	const input = JSON.parse(body);
	if (input.stream) {
		res.writeHead(200, { "content-type": "text/event-stream" });
		const chunk = (delta: object, reason: string | null) =>
			res.write(
				`data: ${JSON.stringify({ id: "reply-test", object: "chat.completion.chunk", created: 1, model: "title-fixture", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
			);
		chunk(
			{ role: "assistant", content: "A controlled reply about the river." },
			null,
		);
		const finish = () => {
			chunk({}, "stop");
			res.write(
				`data: ${JSON.stringify({ id: "reply-test", object: "chat.completion.chunk", created: 1, model: "title-fixture", choices: [], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })}\n\ndata: [DONE]\n\n`,
			);
			res.end();
		};
		if (mode === "title-first" || mode === "stopped") heldReplies.push(finish);
		else finish();
	} else {
		titleCalls++;
		const finish = () =>
			sendTitle(
				res,
				mode === "failure"
					? "Here is the title:\nAn explanation"
					: "The River's Narrative Role",
			);
		heldTitles.push(finish);
	}
});
function sendTitle(res: ServerResponse, text: string) {
	res.setHeader("content-type", "application/json");
	res.end(
		JSON.stringify({
			id: "title-test",
			object: "chat.completion",
			created: 1,
			model: "title-fixture",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: text },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		}),
	);
}
async function port() {
	const server = createServer();
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No port");
	const value = address.port;
	await new Promise<void>((r, reject) =>
		server.close((e) => (e ? reject(e) : r())),
	);
	return value;
}
function startApp(role: string, appPort: number) {
	const child = spawn(process.execPath, [".output/server/index.mjs"], {
		windowsHide: true,
		env: {
			...process.env,
			NODE_ENV: "production",
			DATABASE_URL: container.getConnectionUri(),
			MARGINALIA_SECRET_KEY: secret,
			AUTH_PASSWORD: password,
			HOST: "127.0.0.1",
			PORT: String(appPort),
			MARGINALIA_ROLE: role,
			MARGINALIA_DATA_DIR: dataDir,
			MARGINALIA_LIBRARY_PATHS: "",
			MARGINALIA_SCAN_INTERVAL_MINUTES: "0",
			TITLE_CONCURRENCY: "2",
			LOG_LEVEL: "warn",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout?.on("data", (d) => {
		output += String(d);
	});
	child.stderr?.on("data", (d) => {
		output += String(d);
	});
	return child;
}
async function ready(url: string) {
	await expect
		.poll(
			async () => {
				try {
					return (await fetch(`${url}/api/health`)).status;
				} catch {
					return 0;
				}
			},
			{
				timeout: 45_000,
				message: `Production processes must become healthy: ${output}`,
			},
		)
		.toBe(200);
}
async function stop(child: ChildProcess | undefined) {
	if (!child || child.exitCode !== null) return;
	child.kill();
	await new Promise<void>((r) => child.once("exit", () => r()));
}

test.beforeAll(async () => {
	test.setTimeout(120_000);
	container = await new PostgreSqlContainer("pgvector/pgvector:pg17").start();
	handle = createDb(container.getConnectionUri());
	await runMigrations(handle.pool, { info() {}, error() {} });
	dataDir = await mkdtemp(path.join(os.tmpdir(), "title-browser-"));
	await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
	const address = provider.address();
	if (!address || typeof address === "string")
		throw new Error("No provider port");
	await handle.db.insert(aiCredentials).values({
		provider: "openai-compatible",
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
	});
	editionId = (
		await ensureEdition(handle.db, "browser-title-book", "The River Book")
	).edition.id;
	await handle.db
		.update(editions)
		.set({ status: "ready" })
		.where(eq(editions.id, editionId));
	const webPort = await port();
	appUrl = `http://127.0.0.1:${webPort}`;
	web = startApp("web", webPort);
	await ready(appUrl);
	const workerPort = await port();
	worker = startApp("worker", workerPort);
	await ready(`http://127.0.0.1:${workerPort}`);
});
test.afterAll(async () => {
	heldTitles.splice(0).forEach((f) => {
		f();
	});
	heldReplies.splice(0).forEach((f) => {
		f();
	});
	await stop(worker);
	await stop(web);
	await handle?.pool.end();
	await new Promise<void>((r) => provider.close(() => r()));
	await container?.stop();
	if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => {
	mode = "reply-first";
	titleCalls = 0;
	heldTitles.splice(0).forEach((f) => {
		f();
	});
	heldReplies.splice(0).forEach((f) => {
		f();
	});
	await page.goto(`${appUrl}/login`);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL(`${appUrl}/`);
});
async function open(page: Page) {
	const { id } = await createConversation(handle.db, {
		editionIds: [editionId],
		model: { provider: "openai-compatible", model: "title-fixture" },
	});
	await page.goto(`${appUrl}/c/${id}`);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"New conversation",
	);
	await page
		.getByRole("textbox", { name: "Message" })
		.fill("Why does the river matter?");
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await expect.poll(() => heldTitles.length).toBeGreaterThan(0);
	return id;
}
const release = () =>
	heldTitles.splice(0).forEach((f) => {
		f();
	});

test("reply finishes first, then title and usage refresh without a new message and preserve a draft", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await open(page);
	await expect(
		page.getByText("A controlled reply about the river.", { exact: true }),
	).toBeVisible();
	await page.getByRole("textbox", { name: "Message" }).fill("A typed draft");
	release();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"The River's Narrative Role",
	);
	await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(
		"A typed draft",
	);
	await expect(page.getByTestId("naming-usage")).toContainText("Title naming");
	expect(titleCalls).toBe(1);
	expect(errors).toEqual([]);
});
test("title finishes first while the reply is streaming, then reply usage updates independently", async ({
	page,
}) => {
	mode = "title-first";
	await open(page);
	release();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"The River's Narrative Role",
	);
	await expect(
		page.getByText("A controlled reply about the river.", { exact: true }),
	).toBeVisible();
	heldReplies.splice(0).forEach((f) => {
		f();
	});
	await expect(page.getByTestId("usage-total")).toContainText("45");
	expect(titleCalls).toBe(1);
});
test("manual rename wins a late title result", async ({ page }) => {
	await open(page);
	await page.getByRole("button", { name: /^Rename/ }).click();
	await page
		.getByRole("textbox", { name: "Conversation title" })
		.fill("My River Notes");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"My River Notes",
	);
	release();
	await page.reload();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"My River Notes",
	);
	expect(titleCalls).toBe(1);
});
test("stopping a reply leaves naming independent", async ({ page }) => {
	mode = "stopped";
	await open(page);
	await page.getByRole("button", { name: /Stop/ }).click();
	release();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"The River's Narrative Role",
	);
	expect(titleCalls).toBe(1);
	heldReplies.splice(0).forEach((f) => {
		f();
	});
});
for (const surface of ["dashboard", "global", "book"])
	test(`mounted ${surface} list refreshes after navigation without new activity`, async ({
		page,
	}) => {
		const id = await open(page);
		const before = (
			await handle.pool.query(
				"select updated_at from conversations where id=$1",
				[id],
			)
		).rows[0].updated_at;
		await page.goto(
			surface === "global"
				? `${appUrl}/conversations`
				: surface === "book"
					? `${appUrl}/books/${editionId}`
					: `${appUrl}/`,
		);
		release();
		const row = page
			.getByTestId("conversation-row")
			.filter({ has: page.locator(`a[href="/c/${id}"]`) });
		await expect(row.getByTestId("conversation-title")).toHaveText(
			"The River's Narrative Role",
		);
		expect(
			(
				await handle.pool.query(
					"select updated_at from conversations where id=$1",
					[id],
				)
			).rows[0].updated_at,
		).toEqual(before);
		await page.goto(`${appUrl}/c/${id}`);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"The River's Narrative Role",
		);
		expect(titleCalls).toBe(1);
	});
test("failed naming preserves provisional title and a usable conversation across reload", async ({
	page,
}) => {
	mode = "failure";
	const id = await open(page);
	release();
	await expect
		.poll(
			async () =>
				(
					await handle.pool.query(
						"select naming_state from conversations where id=$1",
						[id],
					)
				).rows[0].naming_state,
		)
		.toBe("failed");
	await page.reload();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Why does the river matter?",
	);
	await expect(page.getByRole("textbox", { name: "Message" })).toBeEnabled();
	expect(titleCalls).toBe(1);
});

test("metadata server functions require authentication", async ({
	page,
	playwright,
}) => {
	await open(page);
	const request = await page.waitForRequest(
		(req) => req.url().includes("/_serverFn/") && req.method() === "GET",
	);
	const anonymous = await playwright.request.newContext();
	try {
		const response = await anonymous.get(request.url(), { maxRedirects: 0 });
		expect(response.status()).toBe(401);
	} finally {
		await anonymous.dispose();
		release();
	}
});
test("leaving a streaming reply does not cancel naming", async ({ page }) => {
	mode = "stopped";
	const id = await open(page);
	await page.goto(`${appUrl}/conversations`);
	release();
	const row = page
		.getByTestId("conversation-row")
		.filter({ has: page.locator(`a[href="/c/${id}"]`) });
	await expect(row.getByTestId("conversation-title")).toHaveText(
		"The River's Narrative Role",
	);
	expect(titleCalls).toBe(1);
	heldReplies.splice(0).forEach((f) => {
		f();
	});
});
