import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
	PostgreSqlContainer,
	type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
	createConversation,
	getConversation,
} from "../src/modules/conversation";
import { editions, ensureEdition } from "../src/modules/library";
import {
	aiCredentials,
	getDiscussionPromptOverride,
} from "../src/modules/settings";
import { createDb, type DbHandle } from "../src/server/db";
import { runMigrations } from "../src/server/db/migrate";

// Build first. Isolated DB, local deterministic provider, and a simulated upgrade
// of this test's generated server artifact (restored afterwards); no source changes.
let container: StartedPostgreSqlContainer;
let handle: DbHandle;
let web: ChildProcess;
let appUrl: string;
let appPort: number;
let dataDir: string;
let editionId: string;
let output = "";
const password = "prompt-browser-tests";
const requests: { messages: { role: string; content: string }[] }[] = [];
const originals = new Map<string, string>();
const provider = createServer(async (req, res) => {
	if (req.url === "/v1/models") {
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({ data: [{ id: "prompt-fixture", object: "model" }] }),
		);
		return;
	}
	let body = "";
	for await (const chunk of req) body += chunk;
	const input = JSON.parse(body);
	requests.push(input);
	res.writeHead(200, { "content-type": "text/event-stream" });
	const chunk = (delta: object, reason: string | null) =>
		res.write(
			`data: ${JSON.stringify({ id: "prompt-test", object: "chat.completion.chunk", created: 1, model: "prompt-fixture", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`,
		);
	chunk({ role: "assistant", content: "A controlled literary reply." }, null);
	chunk({}, "stop");
	res.end("data: [DONE]\n\n");
});
async function port() {
	const server = createServer();
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No port");
	await new Promise<void>((r) => server.close(() => r()));
	return address.port;
}
function startApp() {
	const child = spawn(process.execPath, [".output/server/index.mjs"], {
		windowsHide: true,
		env: {
			...process.env,
			NODE_ENV: "production",
			DATABASE_URL: container.getConnectionUri(),
			MARGINALIA_SECRET_KEY: Buffer.alloc(32, 9).toString("base64"),
			AUTH_PASSWORD: password,
			HOST: "127.0.0.1",
			PORT: String(appPort),
			MARGINALIA_ROLE: "web",
			MARGINALIA_WORKER: "false",
			MARGINALIA_DATA_DIR: dataDir,
			MARGINALIA_LIBRARY_PATHS: "",
			MARGINALIA_SCAN_INTERVAL_MINUTES: "0",
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
async function stop() {
	if (!web || web.exitCode !== null) return;
	web.kill();
	await new Promise<void>((r) => web.once("exit", () => r()));
}
async function ready() {
	await expect
		.poll(
			async () => {
				try {
					return (await fetch(`${appUrl}/api/health`)).status;
				} catch {
					return 0;
				}
			},
			{ timeout: 45_000, message: output },
		)
		.toBe(200);
}
async function upgrade(dir: string) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) await upgrade(file);
		else if (file.endsWith(".mjs")) {
			const text = await readFile(file, "utf8");
			const needle = "Be concise. Prefer a few well-chosen passages to many.";
			if (text.includes(needle)) {
				originals.set(file, text);
				await writeFile(
					file,
					text.replaceAll(
						needle,
						`${needle} Simulated latest default improvement.`,
					),
				);
			}
		}
	}
}
test.beforeAll(async () => {
	container = await new PostgreSqlContainer("pgvector/pgvector:pg17").start();
	handle = createDb(container.getConnectionUri());
	await runMigrations(handle.pool, { info() {}, error() {} });
	dataDir = await mkdtemp(path.join(os.tmpdir(), "prompt-browser-"));
	editionId = (
		await ensureEdition(handle.db, "browser-prompt-book", "The Prompt Book")
	).edition.id;
	await handle.db
		.update(editions)
		.set({ status: "ready" })
		.where(eq(editions.id, editionId));
	await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
	appPort = await port();
	appUrl = `http://127.0.0.1:${appPort}`;
	web = startApp();
	await ready();
});
test.afterAll(async () => {
	await stop();
	for (const [file, text] of originals) await writeFile(file, text);
	await handle?.pool.end();
	await new Promise<void>((r) => provider.close(() => r()));
	await container?.stop();
	if (dataDir) {
		if (
			path.dirname(dataDir) !== os.tmpdir() ||
			!path.basename(dataDir).startsWith("prompt-browser-")
		)
			throw new Error("Unexpected temporary folder");
		await rm(dataDir, { recursive: true, force: true });
	}
});
test("save, resume, upgrade, and return to latest default through Settings", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`${appUrl}/login`);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL(`${appUrl}/`);
	await page.goto(`${appUrl}/settings`);
	const section = page.getByRole("region", {
		name: "Conversation prompt",
		exact: true,
	});
	const editor = page.getByRole("textbox", { name: "Discussion instructions" });
	const save = page.getByRole("button", { name: "Save conversation prompt" });
	await expect(section).toContainText("Current: Default");
	await expect(
		page.getByText("No AI provider is configured", { exact: true }),
	).toBeVisible();
	const originalDefault = await editor.inputValue();
	await editor.fill("unsaved draft");
	await page.reload();
	await expect(editor).toHaveValue(originalDefault);
	await editor.fill("  ");
	await save.click();
	await expect(section.getByRole("alert")).toContainText(
		"Enter a discussion prompt",
	);
	await editor.fill("x".repeat(32001));
	await save.click();
	await expect(section.getByRole("alert")).toContainText("32,000");
	const custom =
		"My own discussion policy: reveal endings from memory and write one paragraph.";
	await editor.fill(custom);
	await save.click();
	await expect(section).toContainText("Current: Custom");
	await page.reload();
	await expect(editor).toHaveValue(custom);
	const address = provider.address();
	if (!address || typeof address === "string") throw new Error("No provider");
	await handle.db.insert(aiCredentials).values({
		provider: "openai-compatible",
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
	});
	const { id } = await createConversation(handle.db, {
		editionIds: [editionId],
		model: { provider: "openai-compatible", model: "prompt-fixture" },
	});
	async function reply(text: string, count: number) {
		await page.goto(`${appUrl}/c/${id}`);
		await page.getByRole("textbox", { name: "Message" }).fill(text);
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect
			.poll(async () => (await getConversation(handle.db, id))?.messages.length)
			.toBe(count);
	}
	await reply("First message", 2);
	expect(requests[0]?.messages[0]?.content).toContain(custom);
	const historical = (await getConversation(handle.db, id))?.messages;
	const customIdentity = historical?.[1]?.promptVersion;
	await expect(page.getByTestId("spoiler-notice")).toContainText(
		"custom prompt",
	);
	await stop();
	await upgrade(path.resolve(".output/server"));
	expect(originals.size).toBeGreaterThan(0);
	web = startApp();
	await ready();
	await page.goto(`${appUrl}/settings`);
	await expect(editor).toHaveValue(custom);
	expect(await getDiscussionPromptOverride(handle.db)).toBe(custom);
	await reply("After upgrading with Custom", 4);
	expect(requests[1]?.messages[0]?.content).toContain(custom);
	expect(requests[1]?.messages[0]?.content).not.toContain(
		"Simulated latest default improvement",
	);
	expect(
		(await getConversation(handle.db, id))?.messages[3]?.promptVersion,
	).toBe(customIdentity);
	await page.goto(`${appUrl}/settings`);
	await page
		.getByRole("button", { name: "Return to default", exact: true })
		.click();
	await expect(section).toContainText("Current: Default");
	await expect(editor).toHaveValue(
		`${originalDefault} Simulated latest default improvement.`,
	);
	expect(await getDiscussionPromptOverride(handle.db)).toBeNull();
	await reply("After reset", 6);
	expect(requests[2]?.messages[0]?.content).toContain(
		"Simulated latest default improvement",
	);
	expect(requests[2]?.messages[0]?.content).toContain(
		"Retrieve before you claim",
	);
	const final = (await getConversation(handle.db, id))?.messages;
	expect(final?.slice(0, 2)).toEqual(historical);
	expect(final?.[5]?.promptVersion).toMatch(/^8:default:[a-f0-9]{64}$/);
	expect(final?.[5]?.promptVersion).not.toBe(customIdentity);
	await page.reload();
	await expect(page.getByTestId("spoiler-notice")).not.toContainText(
		"custom prompt",
	);
	expect(errors).toEqual([]);
});
