import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { buildEpub } from "../test/epub-builder";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const MAX_UPLOAD_MB = Number(process.env.E2E_MAX_UPLOAD_MB ?? 200);
const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });

test.afterAll(async () => {
	await db.end();
});

// Server-only code leaking into the client bundle shows up as uncaught page errors.
let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
	pageErrors = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
	expect(pageErrors).toEqual([]);
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
	const { rows } = await db.query(sql, params);
	if (!rows[0]) throw new Error(`no row for: ${sql}`);
	return rows[0] as T;
}

const manifesto = () =>
	one<{ id: string; short_id: string; parser_version: number }>(
		"select id, short_id, parser_version from editions where title = 'The Communist Manifesto' and status = 'ready' limit 1",
	);

async function login(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL("/");
	// Interactions below need the client to have hydrated.
	await page.waitForLoadState("networkidle");
}

const highlighted = (page: Page) => page.locator('[aria-current="true"]');

test.describe("logging in and out", () => {
	test("logged out → login → original page → logout", async ({ page }) => {
		const { id } = await manifesto();
		const { locator } = await one<{ locator: string }>(
			"select locator from passages where edition_id = $1 and spine_index = 5 and block_index = 2",
			[id],
		);
		await page.goto(`/p/${locator}`);
		await expect(page).toHaveURL(/\/login\?next=/);

		await page.getByLabel("Password").fill("wrong password");
		await page.getByRole("button", { name: "Log in" }).click();
		await expect(page.getByRole("alert")).toHaveText("Incorrect password");

		await page.getByLabel("Password").fill(PASSWORD);
		await page.getByRole("button", { name: "Log in" }).click();
		await expect(page).toHaveURL(
			new RegExp(
				`/p/${locator.replace(/[.:]/g, (c) => `(\\${c}|%${c.charCodeAt(0).toString(16).toUpperCase()})`)}$`,
			),
		);
		await expect(highlighted(page)).toContainText(
			"history of all hitherto existing society",
		);

		await page.getByRole("button", { name: "Log out" }).click();
		await expect(page).toHaveURL(/\/login$/);
		await page.goto("/");
		await expect(page).toHaveURL(/\/login\?next=%2F$/);
	});

	test("login works without client JavaScript", async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();
		await page.goto("/login?next=%2F");
		await page.getByLabel("Password").fill(PASSWORD);
		await page.getByRole("button", { name: "Log in" }).click();
		await expect(page).toHaveURL("/");
		await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
		await context.close();
	});
});

test.describe("library", () => {
	test.beforeEach(async ({ page }) => login(page));

	test("an upload goes from processing to ready without a reload", async ({
		page,
	}) => {
		const title = `E2E Upload ${randomUUID().slice(0, 8)}`;
		const bytes = await buildEpub({
			title,
			creators: ["Test Author"],
			chapters: Array.from({ length: 40 }, (_, i) => ({
				href: `c${i}.xhtml`,
				title: `Chapter ${i}`,
				body: Array.from(
					{ length: 50 },
					(_, k) => `<p>Paragraph ${k} of chapter ${i}.</p>`,
				).join(""),
			})),
		});
		let reloaded = false;
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame()) reloaded = true;
		});
		await page.locator("#upload").setInputFiles({
			name: "upload.epub",
			mimeType: "application/epub+zip",
			buffer: bytes,
		});
		const card = page.getByRole("listitem").filter({ hasText: title });
		await expect(card).toBeVisible({ timeout: 15_000 });
		await expect(card.getByText("Ready")).toBeVisible({ timeout: 30_000 });
		expect(reloaded).toBe(false);
	});

	test("rejects an oversize file before uploading", async ({ page }) => {
		test.skip(
			MAX_UPLOAD_MB > 40,
			"Playwright cannot hand the page a file this large; run with a small MARGINALIA_MAX_UPLOAD_MB",
		);
		const big = Buffer.alloc(MAX_UPLOAD_MB * 1024 * 1024 + 1, 1);
		let uploaded = false;
		page.on("request", (r) => {
			if (r.url().endsWith("/api/uploads")) uploaded = true;
		});
		await page.locator("#upload").setInputFiles({
			name: "big.epub",
			mimeType: "application/epub+zip",
			buffer: big,
		});
		await expect(page.getByRole("alert")).toHaveText(
			`The file is larger than the ${MAX_UPLOAD_MB} MB upload limit.`,
		);
		expect(uploaded).toBe(false);
	});

	test("shows the server's message for a file that is not an EPUB", async ({
		page,
	}) => {
		await page.locator("#upload").setInputFiles({
			name: "notes.epub",
			mimeType: "application/epub+zip",
			buffer: Buffer.from("%PDF-1.7 definitely not a zip"),
		});
		await expect(page.getByRole("alert")).toContainText("not a valid EPUB");
	});

	test("deleting a book needs confirmation and leaves its links not found", async ({
		page,
	}) => {
		const title = `E2E Delete ${randomUUID().slice(0, 8)}`;
		await page.locator("#upload").setInputFiles({
			name: "delete-me.epub",
			mimeType: "application/epub+zip",
			buffer: await buildEpub({
				title,
				chapters: [
					{ href: "c1.xhtml", title: "One", body: "<p>Soon to be gone.</p>" },
				],
			}),
		});
		const card = page.getByRole("listitem").filter({ hasText: title });
		await expect(card.getByText("Ready")).toBeVisible({ timeout: 30_000 });
		const { id, locator } = await one<{ id: string; locator: string }>(
			`select e.id, p.locator from editions e join passages p on p.edition_id = e.id
			 where e.title = $1 order by p.position limit 1`,
			[title],
		);

		await page.goto(`/books/${id}`);
		await page.waitForLoadState("networkidle");
		await page.getByRole("button", { name: "Delete book" }).click();
		const dialog = page.getByRole("alertdialog");
		await expect(dialog).toContainText(`Delete “${title}”?`);
		await expect(dialog).toContainText("cannot be undone");
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();
		await expect(page).toHaveURL(`/books/${id}`);

		await page.getByRole("button", { name: "Delete book" }).click();
		await dialog.getByRole("button", { name: "Delete", exact: true }).click();
		await expect(page).toHaveURL("/");
		await expect(card).toHaveCount(0);

		await page.goto(`/books/${id}`);
		await expect(
			page.getByRole("heading", { name: "Not found", level: 1 }),
		).toBeVisible();
		expect((await page.request.get(`/api/covers/${id}`)).status()).toBe(404);
		await page.goto(`/p/${locator}`);
		await expect(
			page.getByRole("heading", { name: "Passage not found" }),
		).toBeVisible();
	});
});

test.describe("reading", () => {
	test.beforeEach(async ({ page }) => login(page));

	test("selecting a chapter in the table of contents opens its first passage", async ({
		page,
	}) => {
		const { id } = await manifesto();
		await page.goto(`/books/${id}`);
		await expect(
			page.getByRole("heading", { name: "The Communist Manifesto", level: 1 }),
		).toBeVisible();
		await expect(page.getByText("Karl Marx, Friedrich Engels")).toBeVisible();
		await page
			.getByRole("link", { name: /Bourgeois and Proletarians/ })
			.click();
		await expect(page).toHaveURL(/\/p\//);
		await expect(highlighted(page)).toHaveText("I");
		await expect(page.locator("[data-locator]").nth(1)).toHaveText(
			/^Bourgeois and Proletarians/,
		);
	});

	test("searching and selecting a result opens that passage", async ({
		page,
	}) => {
		const { id } = await manifesto();
		await page.goto(`/books/${id}`);
		await page.getByLabel("Search text").fill("hitherto existing society");
		await page.getByRole("button", { name: "Search" }).click();
		const result = page
			.getByRole("listitem")
			.filter({ has: page.locator("mark") })
			.first();
		await expect(result).toBeVisible();
		await expect(result.locator("mark").first()).toBeVisible();
		await result.getByRole("link").click();
		await expect(highlighted(page)).toContainText("hitherto existing society");

		await page.goto(`/books/${id}?q=xyzzyqqq`);
		await expect(
			page.getByText("No passages matched “xyzzyqqq”."),
		).toBeVisible();
	});

	test("a passage that references a footnote opens the note", async ({
		page,
	}) => {
		const { id } = await manifesto();
		const ref = await one<{ locator: string; note: string }>(
			`select f.locator, t.text as note from note_refs n
			 join passages f on f.id = n.from_passage_id join passages t on t.id = n.to_passage_id
			 where f.edition_id = $1 order by f.position limit 1`,
			[id],
		);
		await page.goto(`/p/${ref.locator}`);
		await page.waitForLoadState("networkidle");
		const passage = highlighted(page);
		await expect(passage).toBeVisible();
		await passage.getByText("Note 1").click();
		await expect(passage.getByText(ref.note.slice(0, 40))).toBeVisible();
	});

	test("a superseded locator redirects to the current one; a removed one explains itself", async ({
		page,
	}) => {
		const { id, short_id, parser_version } = await manifesto();
		const { locator: current } = await one<{ locator: string }>(
			"select locator from passages where edition_id = $1 and spine_index = 6 and block_index = 3",
			[id],
		);
		const old = parser_version - 1;
		const superseded = `${short_id}:v${old}:6.9`;
		const removed = `${short_id}:v${old}:1.99`;
		// What a reparse writes: one forwarded locator and one removed.
		await db.query(
			`insert into locator_aliases (edition_id, old_locator, target_locator, match_kind)
			 values ($1, $2, $3, 'exact'), ($1, $4, null, 'removed')
			 on conflict (edition_id, old_locator) do update set target_locator = excluded.target_locator, match_kind = excluded.match_kind`,
			[id, superseded, current, removed],
		);

		await page.goto(`/p/${superseded}`);
		await expect(page).toHaveURL(
			new RegExp(
				`/p/${encodeURIComponent(current).replace(/%3A/g, "(:|%3A)")}$`,
			),
		);
		await expect(highlighted(page)).toBeVisible();
		const text = await one<{ text: string }>(
			"select text from passages where edition_id = $1 and locator = $2",
			[id, current],
		);
		await expect(highlighted(page)).toContainText(text.text.slice(0, 30));

		await page.goto(`/p/${removed}`);
		await expect(
			page.getByRole("heading", { name: "Passage moved or removed" }),
		).toBeVisible();
		await page
			.getByRole("link", { name: "Browse the book's table of contents" })
			.click();
		await expect(page).toHaveURL(`/books/${id}`);
	});
});

test.describe("reading scope", () => {
	test.beforeEach(async ({ page }) => login(page));

	const conversationCount = async (editionId: string) =>
		(
			await one<{ n: number }>(
				"select count(*)::int as n from conversation_editions where edition_id = $1",
				[editionId],
			)
		).n;

	test("cancelling the scope choice creates nothing", async ({ page }) => {
		const { id } = await manifesto();
		const before = await conversationCount(id);
		await page.goto(`/books/${id}`);
		await page.getByRole("button", { name: "Start conversation" }).click();
		const dialog = page.getByTestId("new-conversation-dialog");
		await expect(dialog.getByRole("radio").first()).toBeVisible();
		await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
		await expect(dialog.getByRole("button", { name: "Start" })).toBeDisabled();
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();
		await expect(page).toHaveURL(`/books/${id}`);
		expect(await conversationCount(id)).toBe(before);
	});

	test("starts a conversation through a chapter and widens it", async ({
		page,
	}) => {
		const { id } = await manifesto();
		const scope =
			"Through The Communist Manifesto › II: Proletarians and Communists";
		await page.goto(`/books/${id}`);
		await page.getByRole("button", { name: "Start conversation" }).click();
		const dialog = page.getByTestId("new-conversation-dialog");
		await dialog.getByRole("button", { name: /^I'm partway through/ }).click();
		await dialog
			.getByRole("radio", { name: "II: Proletarians and Communists" })
			.check();
		await expect(dialog.getByTestId("scope-note")).toBeVisible();
		await expect(dialog.getByTestId("spoiler-notice")).toHaveCount(0);
		await dialog.getByRole("button", { name: "Start" }).click();

		await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
		const conversationId = page.url().split("/c/")[1] as string;
		await expect(page.getByTestId("scope-chip")).toHaveText(scope);
		await expect(page.getByTestId("scope-note")).toBeVisible();
		await expect(page.getByTestId("spoiler-notice")).toHaveCount(0);

		await page.getByRole("link", { name: "← Conversations" }).click();
		const entry = page
			.getByRole("listitem")
			.filter({ has: page.locator(`a[href="/c/${conversationId}"]`) });
		await expect(entry.getByTestId("conversation-scope")).toHaveText(scope);

		await entry.locator(`a[href="/c/${conversationId}"]`).click();
		await page.getByRole("button", { name: /^Widen scope/ }).click();
		const widen = page.getByTestId("widen-scope-dialog");
		await widen.getByRole("button", { name: /^I'm partway through/ }).click();
		await expect(
			widen.getByRole("radio", { name: "I: Bourgeois and Proletarians" }),
		).toHaveCount(0);
		await expect(
			widen.getByRole("radio", { name: "II: Proletarians and Communists" }),
		).toHaveCount(0);
		await widen.getByRole("radio", { name: "Whole book" }).check();
		await widen.getByRole("button", { name: "Widen" }).click();
		await expect(widen).toBeHidden();
		await expect(page.getByTestId("scope-chip")).toHaveText("Whole book");
		await expect(page.getByTestId("spoiler-notice")).toBeVisible();
		await expect(
			page.getByRole("button", { name: /^Widen scope/ }),
		).toHaveCount(0);
	});
});

test.describe("reply to an assistant selection", () => {
	test("attaches without changing the draft, submits structured context, and reopens", async ({
		page,
	}) => {
		const { id: editionId } = await manifesto();
		const conversationId = randomUUID();
		const sourceId = randomUUID();
		await db.query(
			"insert into conversations (id,title) values ($1,'Reply selection test')",
			[conversationId],
		);
		try {
			await db.query(
				"insert into conversation_editions (conversation_id,edition_id,ordinal) values ($1,$2,0)",
				[conversationId, editionId],
			);
			await db.query(
				"insert into messages (id,conversation_id,seq,role,parts,finish_reason) values ($1,$2,1,'assistant',$3,'aborted')",
				[
					sourceId,
					conversationId,
					JSON.stringify([
						{
							// The citation renders as a pill button; selections across it must still work.
							type: "text",
							text: 'A **particular claim** [[cite locator="x:v1:0.0" quote="claim"]] worth discussing.',
						},
					]),
				],
			);
			await login(page);
			await page.goto(`/c/${conversationId}`);
			test.skip(
				await page
					.getByText("AI is not configured", { exact: true })
					.isVisible(),
				"Selection creation requires configured AI",
			);
			await page.getByLabel("Message", { exact: true }).fill("Why this claim?");
			await page
				.locator(`[data-reply-source="${sourceId}"]`)
				.evaluate((element) => {
					const range = document.createRange();
					range.selectNodeContents(element);
					const selection = window.getSelection();
					selection?.removeAllRanges();
					selection?.addRange(range);
					document.dispatchEvent(new Event("selectionchange"));
				});
			await page
				.getByRole("button", { name: "Reply to selection", exact: true })
				.click();
			await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
				"Why this claim?",
			);
			await expect(page.getByTestId("reply-quote")).toContainText(
				"A particular claim worth discussing.",
			);
			let body:
				| { message: string; replyContext: { messageId: string; text: string } }
				| undefined;
			let attempts = 0;
			await page.route("**/api/chat", async (route) => {
				body = route.request().postDataJSON();
				if (attempts++ === 0) {
					await route.fulfill({
						status: 400,
						contentType: "application/json",
						body: JSON.stringify({ error: "Rejected before storage" }),
					});
					return;
				}
				await db.query(
					"insert into messages (conversation_id,seq,role,parts) values ($1,2,'user',$2)",
					[
						conversationId,
						JSON.stringify([
							{
								type: "data-reply-context",
								data: { version: 1, ...body?.replyContext },
							},
							{ type: "text", text: body?.message },
						]),
					],
				);
				await route.fulfill({
					status: 200,
					contentType: "text/event-stream",
					headers: { "x-vercel-ai-ui-message-stream": "v1" },
					body: 'data: {"type":"start","messageId":"reply"}\n\ndata: {"type":"text-start","id":"t"}\n\ndata: {"type":"text-delta","id":"t","delta":"Follow-up answer"}\n\ndata: {"type":"text-end","id":"t"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
				});
			});
			await page.getByRole("button", { name: "Send", exact: true }).click();
			await page.getByRole("button", { name: "Retry", exact: true }).click();
			await expect(
				page.getByText("Follow-up answer", { exact: true }),
			).toBeVisible();
			expect(body?.replyContext.messageId).toBe(sourceId);
			expect(body?.message).toBe("Why this claim?");
			await page.reload();
			await expect(page.getByTestId("reply-quote")).toContainText(
				"A particular claim worth discussing.",
			);
			await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
		} finally {
			await db.query("delete from conversations where id=$1", [conversationId]);
		}
	});
});

test.describe("passage references", () => {
	const passage = async (spine: number, block: number) => {
		const { id } = await manifesto();
		return one<{ locator: string; text: string }>(
			"select locator, text from passages where edition_id = $1 and spine_index = $2 and block_index = $3",
			[id, spine, block],
		);
	};

	/** A conversation about the Manifesto, optionally bounded through a section's last passage. */
	async function conversation(title: string, throughSpine?: number) {
		const { id: editionId } = await manifesto();
		const id = randomUUID();
		const bound =
			throughSpine === undefined
				? null
				: await one<{ max: number; title: string }>(
						"select max(p.position) as max, s.title from passages p join sections s on s.id = p.section_id where p.edition_id = $1 and p.spine_index = $2 group by s.title",
						[editionId, throughSpine],
					);
		await db.query("insert into conversations (id,title) values ($1,$2)", [
			id,
			title,
		]);
		await db.query(
			"insert into conversation_editions (conversation_id,edition_id,ordinal,max_position,scope_label) values ($1,$2,0,$3,$4)",
			[
				id,
				editionId,
				bound?.max ?? null,
				bound ? `The Communist Manifesto › ${bound.title}` : null,
			],
		);
		return id;
	}

	const message = (page: Page) => page.getByLabel("Message", { exact: true });
	const skipWithoutAi = async (page: Page) =>
		test.skip(
			await page.getByText("AI is not configured", { exact: true }).isVisible(),
			"Passage references in conversations require configured AI",
		);

	test.beforeEach(async ({ page, context, baseURL }) => {
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: baseURL,
		});
		await login(page);
	});

	test("copies passage and selection links by keyboard and pointer", async ({
		page,
		baseURL,
	}) => {
		const target = await passage(5, 2);
		const next = await passage(5, 3);
		await page.goto(`/p/${target.locator}`);
		await page.waitForLoadState("networkidle");
		const block = page.locator(`[data-locator="${target.locator}"]`);
		const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

		// Keyboard: focus the passage's action, open it, and choose Copy link.
		await block.getByRole("button", { name: "Reference this passage" }).focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("menuitem", { name: "Copy link" }),
		).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(block.locator("output")).toHaveText("Link copied.");
		expect(await clipboard()).toBe(`${baseURL}/p/${target.locator}`);

		// Pointer: select a phrase within the passage.
		const select = (
			from: { locator: string; offset: number },
			to: { locator: string; offset: number },
		) =>
			page.evaluate(
				([a, b]) => {
					const text = (locator: string) =>
						document.querySelector(`[data-passage-text="${locator}"]`)
							?.firstChild as Text;
					const range = document.createRange();
					range.setStart(text(a.locator), a.offset);
					range.setEnd(text(b.locator), b.offset);
					const selection = window.getSelection();
					selection?.removeAllRanges();
					selection?.addRange(range);
					document.dispatchEvent(new Event("selectionchange"));
				},
				[from, to] as const,
			);
		const phrase = [
			{ locator: target.locator, offset: 3 },
			{ locator: target.locator, offset: 18 },
		] as const;
		const floating = page.getByRole("button", { name: "Reference selection" });
		await select(...phrase);
		await expect(floating).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(floating).toBeHidden();

		await select(...phrase);
		await floating.click();
		await page.getByRole("menuitem", { name: "Copy link" }).click();
		// The selection's leading space is trimmed from the range.
		expect(await clipboard()).toBe(`${baseURL}/p/${target.locator}?hl=4-18`);
		await page.goto(`/p/${target.locator}?hl=4-18`);
		await expect(page.getByTestId("quote-highlight")).toHaveText(
			target.text.slice(4, 18),
		);

		// Across two passages there is no action.
		await select(
			{ locator: target.locator, offset: 3 },
			{ locator: next.locator, offset: 5 },
		);
		await expect(floating).toBeHidden();
	});

	test("a pasted link attaches a passage, prose pastes as text, and history links back", async ({
		page,
		baseURL,
	}) => {
		const target = await passage(5, 2);
		const id = await conversation("Paste passage test");
		try {
			await page.goto(`/c/${id}`);
			await page.waitForLoadState("networkidle");
			await skipWithoutAi(page);
			const paste = async (text: string) => {
				await page.evaluate((t) => navigator.clipboard.writeText(t), text);
				await message(page).focus();
				await page.keyboard.press("ControlOrMeta+V");
			};
			await message(page).fill("My draft");
			await paste(`${baseURL}/p/${target.locator}?hl=4-11`);
			const quote = page.getByTestId("passage-quote");
			await expect(quote).toContainText("history");
			await expect(quote).toContainText("I: Bourgeois and Proletarians");
			await expect(message(page)).toHaveValue("My draft");

			const prose = ` and see ${baseURL}/p/${target.locator} too`;
			await message(page).press("End");
			await paste(prose);
			await expect(message(page)).toHaveValue(`My draft${prose}`);
			await expect(quote).toContainText("history");

			let body:
				| { message: string; passageRef?: unknown; replyContext?: unknown }
				| undefined;
			await page.route("**/api/chat", async (route) => {
				body = route.request().postDataJSON();
				const { id: editionId } = await manifesto();
				// Store what the server would, then reply.
				await db.query(
					"insert into messages (conversation_id,seq,role,parts) values ($1,1,'user',$2)",
					[
						id,
						JSON.stringify([
							{
								type: "data-passage-context",
								data: {
									version: 1,
									locator: target.locator,
									range: { start: 4, end: 11 },
									editionId,
									bookTitle: "The Communist Manifesto",
									sectionTitle: "I: Bourgeois and Proletarians",
									text: "history",
								},
							},
							{ type: "text", text: body?.message },
						]),
					],
				);
				await route.fulfill({
					status: 200,
					contentType: "text/event-stream",
					headers: { "x-vercel-ai-ui-message-stream": "v1" },
					body: 'data: {"type":"start","messageId":"reply"}\n\ndata: {"type":"text-start","id":"t"}\n\ndata: {"type":"text-delta","id":"t","delta":"About that passage"}\n\ndata: {"type":"text-end","id":"t"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
				});
			});
			await page.getByRole("button", { name: "Send", exact: true }).click();
			await expect(page.getByText("About that passage")).toBeVisible();
			expect(body?.passageRef).toEqual({
				locator: target.locator,
				range: { start: 4, end: 11 },
			});
			expect(body?.replyContext).toBeUndefined();

			await page.reload();
			await expect(page.getByTestId("passage-quote")).toContainText("history");
			await expect(message(page)).toHaveValue("");
			await page.getByRole("link", { name: "Open in book →" }).click();
			await expect(page).toHaveURL(/\/p\/.*\?hl=4-11$/);
			await expect(page.getByTestId("quote-highlight")).toHaveText("history");
		} finally {
			await db.query("delete from conversations where id=$1", [id]);
		}
	});

	test("discussing a passage in a new conversation limits the scope and attaches it once", async ({
		page,
	}) => {
		const target = await passage(6, 3);
		await page.goto(`/p/${target.locator}`);
		await page.waitForLoadState("networkidle");
		const block = page.locator(`[data-locator="${target.locator}"]`);
		await block.hover();
		await block.getByRole("button", { name: "Reference this passage" }).click();
		const discuss = page.getByRole("menuitem", {
			name: "Discuss in a new conversation",
		});
		test.skip(
			!(await discuss.isVisible()),
			"Conversations require configured AI",
		);
		await discuss.click();
		const dialog = page.getByTestId("new-conversation-dialog");
		await expect(dialog.getByTestId("passage-unit-note")).toHaveText(
			"This passage is in The Communist Manifesto › II: Proletarians and Communists.",
		);
		await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
		await dialog.getByRole("button", { name: /^I'm partway through/ }).click();
		await expect(
			dialog.getByRole("radio", { name: "I: Bourgeois and Proletarians" }),
		).toHaveCount(0);
		await dialog
			.getByRole("radio", { name: "II: Proletarians and Communists" })
			.check();
		await dialog.getByRole("button", { name: "Start" }).click();

		await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
		const conversationId = page.url().split("/c/")[1] as string;
		try {
			await expect(page.getByTestId("passage-quote")).toContainText(
				target.text.slice(0, 30),
			);
			await expect(message(page)).toBeFocused();
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(message(page)).toBeVisible();
			await expect(page.getByTestId("passage-quote")).toHaveCount(0);
		} finally {
			await db.query("delete from conversations where id=$1", [conversationId]);
		}
	});

	test("adding a later passage keeps the draft, offers widening, then attaches", async ({
		page,
	}) => {
		const inScope = await passage(5, 2);
		const later = await passage(6, 3);
		const title = `Add passage test ${randomUUID().slice(0, 8)}`;
		const id = await conversation(title, 5);
		try {
			const { id: editionId } = await manifesto();
			// A sent reference, so "Open in book" reaches the passage view without a reload.
			await db.query(
				"insert into messages (conversation_id,seq,role,parts) values ($1,1,'user',$2)",
				[
					id,
					JSON.stringify([
						{
							type: "data-passage-context",
							data: {
								version: 1,
								locator: inScope.locator,
								editionId,
								bookTitle: "The Communist Manifesto",
								sectionTitle: "I: Bourgeois and Proletarians",
								text: inScope.text,
							},
						},
						{ type: "text", text: "Earlier question" },
					]),
				],
			);
			await page.goto(`/c/${id}`);
			await page.waitForLoadState("networkidle");
			await skipWithoutAi(page);
			await message(page).fill("Keep me");
			await page.getByRole("link", { name: "Open in book →" }).click();
			await expect(page).toHaveURL(/\/p\//);
			await page
				.getByRole("link", { name: "II: Proletarians and Communists →" })
				.first()
				.click();
			const block = page.locator(`[data-locator="${later.locator}"]`);
			await expect(block).toBeVisible();
			await block.hover();
			await block
				.getByRole("button", { name: "Reference this passage" })
				.click();
			await page
				.getByRole("menuitem", { name: "Add to a conversation" })
				.click();
			// Move the pointer the way a reader would, so the submenu stays open on the way.
			const choice = page.getByRole("menuitem", { name: new RegExp(title) });
			const box = await choice.boundingBox();
			if (!box) throw new Error("conversation not listed");
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
				steps: 10,
			});
			await choice.click();

			await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
			await expect(message(page)).toHaveValue("Keep me");
			const notice = page.getByTestId("passage-status");
			await expect(notice).toContainText(
				"This passage is in The Communist Manifesto › II: Proletarians and Communists, beyond this conversation's scope.",
			);
			await expect(page.getByTestId("passage-quote")).toHaveCount(1);
			await notice.getByRole("button", { name: /^Widen scope/ }).click();
			const widen = page.getByTestId("widen-scope-dialog");
			await widen.getByRole("button", { name: /^I'm partway through/ }).click();
			await widen
				.getByRole("radio", { name: "II: Proletarians and Communists" })
				.check();
			await widen.getByRole("button", { name: "Widen" }).click();
			await expect(widen).toBeHidden();
			await expect(page.getByTestId("passage-quote")).toHaveCount(2);
			await expect(page.getByTestId("passage-quote").last()).toContainText(
				later.text.slice(0, 30),
			);
			await expect(notice).toHaveCount(0);
			await expect(message(page)).toHaveValue("Keep me");
		} finally {
			await db.query("delete from conversations where id=$1", [id]);
		}
	});
});
