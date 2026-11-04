import { randomUUID } from "node:crypto";
import {
	expect,
	type Locator,
	type Page,
	type Route,
	test,
} from "@playwright/test";
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

/** Types into the library search and waits for the URL to follow. */
async function searchLibrary(page: Page, text: string) {
	await page
		.getByRole("searchbox", { name: "Search by title or author" })
		.fill(text);
	await expect(page).toHaveURL((url) => url.searchParams.get("q") === text);
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
		await searchLibrary(page, title);
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
		await expect(card.getByText("Not started")).toBeVisible({
			timeout: 30_000,
		});
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
		await searchLibrary(page, title);
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
		await expect(card.getByText("Not started")).toBeVisible({
			timeout: 30_000,
		});
		const { id, locator } = await one<{ id: string; locator: string }>(
			`select e.id, p.locator from editions e join passages p on p.edition_id = e.id
			 where e.title = $1 order by p.position limit 1`,
			[title],
		);

		await page.goto(`/books/${id}/about`);
		await page.waitForLoadState("networkidle");
		await page.getByRole("button", { name: "Delete book" }).click();
		const dialog = page.getByRole("alertdialog");
		await expect(dialog).toContainText(`Delete “${title}”?`);
		await expect(dialog).toContainText("cannot be undone");
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();
		await expect(page).toHaveURL(`/books/${id}/about`);

		await page.getByRole("button", { name: "Delete book" }).click();
		await dialog.getByRole("button", { name: "Delete", exact: true }).click();
		await expect(page).toHaveURL("/");
		await expect(card).toHaveCount(0);

		for (const tab of ["", "/about", "/contents", "/guide/chapters"]) {
			await page.goto(`/books/${id}${tab}`);
			await expect(
				page.getByRole("heading", { name: "Not found", level: 1 }),
			).toBeVisible();
		}
		expect((await page.request.get(`/api/covers/${id}`)).status()).toBe(404);
		await page.goto(`/p/${locator}`);
		await expect(
			page.getByRole("heading", { name: "Passage not found" }),
		).toBeVisible();
	});
});

test.describe("library browsing", () => {
	// Seeded straight into the database: ready books with an available file,
	// half of them reading. Removed afterwards.
	const runId = randomUUID().slice(0, 8);
	const prefix = `E2E Shelf ${runId}`;
	// File rows live under a per-run folder so concurrent runs don't delete each other's.
	const shelfDir = `e2e-shelf/${runId}/`;
	const COUNT = 200;
	const READING = COUNT / 2;
	const stateOf = (i: number) =>
		(["finished", "not-started", "reading", "reading"] as const)[i % 4];

	test.beforeAll(async () => {
		const { id: sourceId } = await one<{ id: number }>(
			"select id from library_sources where kind = 'upload' limit 1",
		);
		const { rows } = await db.query<{ id: string; title: string }>(
			`insert into editions (sha256, short_id, title, authors, status)
			 select sha, substr(sha, 1, 16), $1 || ' ' || lpad(g::text, 3, '0'),
			        '["Shelf Author"]'::jsonb, 'ready'
			 from (
			   select g, md5($1 || g) || md5(g || $1) as sha
			   from generate_series(1, $2::int) g
			 ) s
			 returning id, title`,
			[prefix, COUNT],
		);
		await db.query(
			`insert into library_files (source_id, rel_path, size, mtime, sha256)
			 select $1, $3 || sha256 || '.epub', 1, now(), sha256
			 from editions where title like $2 || ' %'`,
			[sourceId, prefix, shelfDir],
		);
		for (const row of rows) {
			const state = stateOf(Number(row.title.slice(-3)));
			if (state === "not-started") continue;
			await db.query(
				`insert into reading_positions (edition_id, max_position, scope_label)
				 values ($1, $2, $3)`,
				state === "reading" ? [row.id, 1, "Chapter 1"] : [row.id, null, null],
			);
		}
	});

	test.afterAll(async () => {
		await db.query("delete from editions where title like $1 || ' %'", [
			prefix,
		]);
		await db.query("delete from library_files where rel_path like $1 || '%'", [
			shelfDir,
		]);
	});

	test.beforeEach(async ({ page }) => login(page));

	const cards = (page: Page) => page.getByRole("main").getByRole("listitem");
	const count = (page: Page) => page.getByTestId("library-count");

	test("search narrows the list, keeps history, and survives a reload", async ({
		page,
	}) => {
		const historyBefore = await page.evaluate(() => history.length);
		// Typed key by key: the URL follows, but no history entry is added per change.
		await page
			.getByRole("searchbox", { name: "Search by title or author" })
			.pressSequentially(`${prefix} 00`, { delay: 20 });
		await expect(page).toHaveURL(
			(url) => url.searchParams.get("q") === `${prefix} 00`,
		);
		await expect(cards(page)).toHaveCount(9);
		await expect(count(page)).toHaveText(/^9 of \d+ books$/);
		expect(await page.evaluate(() => history.length)).toBe(historyBefore);

		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(
			page.getByRole("searchbox", { name: "Search by title or author" }),
		).toHaveValue(`${prefix} 00`);
		await expect(cards(page)).toHaveCount(9);

		await searchLibrary(page, `${prefix} no such book`);
		await expect(page.getByText("No books match")).toBeVisible();
		await page.getByRole("button", { name: "Clear search and filter" }).click();
		await expect(page).toHaveURL("/");
		await expect(
			page.getByRole("searchbox", { name: "Search by title or author" }),
		).toHaveValue("");
	});

	test("the status filter shows only matching books", async ({ page }) => {
		await searchLibrary(page, `${prefix} 01`);
		await expect(cards(page)).toHaveCount(10);
		await page
			.getByRole("group", { name: "Filter by status" })
			.getByRole("button", { name: "Finished" })
			.click();
		await expect(page).toHaveURL(
			(url) => url.searchParams.get("status") === "finished",
		);
		// 012 and 016 of 010–019.
		await expect(cards(page)).toHaveCount(2);
		for (const card of await cards(page).all()) {
			await expect(card.getByText("Finished", { exact: true })).toBeVisible();
		}
		await expect(count(page)).toHaveText(/^2 of \d+ books$/);
	});

	test("scrolling loads every book once, and back restores the list", async ({
		page,
	}) => {
		await page.goto(`/?q=${encodeURIComponent(prefix)}&status=reading`);
		await page.waitForLoadState("networkidle");
		await expect(count(page)).toHaveText(new RegExp(`^${READING} of `));
		await expect(cards(page)).toHaveCount(60);
		// Scroll until every reading book is loaded; loading then stops.
		while ((await cards(page).count()) < READING) {
			await page.mouse.wheel(0, 4000);
			await page.waitForTimeout(100);
		}
		await page.waitForLoadState("networkidle");
		await expect(cards(page)).toHaveCount(READING);
		await expect(cards(page).getByText("Reading", { exact: true })).toHaveCount(
			READING,
		);
		const titles = await cards(page).getByRole("heading").allTextContents();
		expect(new Set(titles).size).toBe(READING);
		expect(titles).toEqual([...titles].sort());

		const last = titles.at(-1) ?? "";
		await page.getByRole("link", { name: last }).click();
		await expect(page).toHaveURL(/\/books\//);
		await page.goBack();
		await expect(page).toHaveURL(
			(url) =>
				url.searchParams.get("q") === prefix &&
				url.searchParams.get("status") === "reading",
		);
		await expect(cards(page)).toHaveCount(READING);
		await expect(page.getByRole("link", { name: last })).toBeInViewport();
	});
});

test.describe("reading", () => {
	test.beforeEach(async ({ page }) => login(page));

	test("selecting a chapter in the table of contents opens its first passage", async ({
		page,
	}) => {
		const { id } = await manifesto();
		await page.goto(`/books/${id}/contents`);
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
		await page.goto(`/books/${id}/contents`);
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

		// An old search link lands on Contents with the search run.
		await page.goto(`/books/${id}?q=xyzzyqqq`);
		await expect(page).toHaveURL(`/books/${id}/contents?q=xyzzyqqq`);
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
		await expect(page).toHaveURL(`/books/${id}/contents`);
	});
});

test.describe("book page", () => {
	test.beforeEach(async ({ page }) => login(page));

	const tabs = (page: Page) => page.getByRole("navigation", { name: "Book" });
	const tab = (page: Page, name: string) =>
		tabs(page).getByRole("link", { name, exact: true });

	test("opens on Discuss, and each tab has a URL that survives a reload", async ({
		page,
	}) => {
		const { id } = await manifesto();
		await page.goto(`/books/${id}`);
		await expect(
			page.getByRole("heading", { name: "The Communist Manifesto", level: 1 }),
		).toBeVisible();
		await expect(tab(page, "Discuss")).toHaveAttribute("aria-current", "page");
		await expect(page.getByTestId("reading-position")).toBeVisible();

		await tab(page, "About").click();
		await expect(page).toHaveURL(`/books/${id}/about`);
		await expect(tab(page, "About")).toHaveAttribute("aria-current", "page");
		await expect(tab(page, "Discuss")).not.toHaveAttribute("aria-current");
		await page.reload();
		await expect(tab(page, "About")).toHaveAttribute("aria-current", "page");
		await expect(page.getByText("Parser version")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Delete book" }),
		).toBeVisible();

		await tab(page, "Contents").click();
		await expect(page).toHaveURL(`/books/${id}/contents`);
		await expect(page.getByTestId("reading-position")).toBeVisible();
		await expect(page.getByLabel("Search text")).toBeVisible();
	});

	test("every Guide URL opens inside the book page with the Guide tab current", async ({
		page,
	}) => {
		const { id } = await manifesto();
		for (const path of [
			"guide",
			"guide/chapters",
			"guide/index",
			"guide/notes",
			"guide/notes/new",
		]) {
			await page.goto(`/books/${id}/${path}`);
			await expect(
				page.getByRole("heading", {
					name: "The Communist Manifesto",
					level: 1,
				}),
			).toBeVisible();
			await expect(tab(page, "Guide")).toHaveAttribute("aria-current", "page");
			await expect(
				page.getByRole("heading", { name: "Guide", level: 1 }),
			).toHaveCount(0);
			await expect(
				page.getByRole("navigation", { name: "Guide" }),
			).toBeVisible();
		}
		await expect(page).toHaveURL(`/books/${id}/guide/notes/new`);
	});

	test("setting the position from the header updates its label and progress", async ({
		page,
	}) => {
		const { id } = await manifesto();
		const saved = await db.query(
			"select max_position, scope_label from reading_positions where edition_id = $1",
			[id],
		);
		await db.query("delete from reading_positions where edition_id = $1", [id]);
		try {
			await page.goto(`/books/${id}`);
			await page.waitForLoadState("networkidle");
			const header = page.getByTestId("reading-position");
			await expect(page.getByTestId("reading-position-value")).toHaveText(
				"Not set",
			);
			await expect(header.getByRole("progressbar")).toHaveCount(0);

			await header.getByRole("button", { name: "Set position" }).click();
			const dialog = page.getByTestId("reading-position-dialog");
			await dialog
				.getByRole("button", { name: /^I'm partway through/ })
				.click();
			await dialog
				.getByRole("radio", { name: "II: Proletarians and Communists" })
				.check();
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog).toBeHidden();

			await expect(page.getByTestId("reading-position-value")).toContainText(
				"II: Proletarians and Communists",
			);
			await expect(header.getByRole("progressbar")).toBeVisible();
			await expect(page.getByTestId("reading-progress")).toHaveText(
				/^\d+ of \d+$/,
			);

			await tab(page, "Contents").click();
			await expect(page.getByTestId("reading-position-value")).toContainText(
				"II: Proletarians and Communists",
			);
		} finally {
			await db.query("delete from reading_positions where edition_id = $1", [
				id,
			]);
			const row = saved.rows[0];
			if (row) {
				await db.query(
					"insert into reading_positions (edition_id, max_position, scope_label) values ($1, $2, $3)",
					[id, row.max_position, row.scope_label],
				);
			}
		}
	});

	test("an edition that is still importing offers no Guide and no conversations", async ({
		page,
	}) => {
		const sha = randomUUID().replace(/-/g, "").repeat(2);
		const { id } = await one<{ id: string }>(
			`insert into editions (sha256, short_id, title, status)
			 values ($1, substr($1, 1, 16), 'E2E Importing', 'processing') returning id`,
			[sha],
		);
		try {
			await page.goto(`/books/${id}`);
			await expect(
				page.getByRole("heading", { name: "E2E Importing", level: 1 }),
			).toBeVisible();
			await expect(page.getByTestId("import-status")).toBeVisible();
			await expect(page.getByTestId("reading-position")).toHaveCount(0);
			await expect(tab(page, "Discuss")).toBeVisible();
			await expect(tab(page, "Guide")).toHaveCount(0);
			await expect(page.getByTestId("discuss-not-ready")).toBeVisible();
			await expect(page.getByTestId("book-composer")).toHaveCount(0);
			await expect(page.getByTestId("ai-setup")).toHaveCount(0);
		} finally {
			await db.query("delete from editions where id = $1", [id]);
		}
	});

	test("the former conversation list URL opens Discuss", async ({ page }) => {
		const { id } = await manifesto();
		await page.goto(`/books/${id}/conversations`);
		await expect(page).toHaveURL(`/books/${id}`);
		await expect(tab(page, "Discuss")).toHaveAttribute("aria-current", "page");
		await expect(
			page.getByRole("heading", { name: "Conversations", level: 2 }),
		).toBeVisible();
	});
});

/** The rows of the AI settings tables, put back by the returned function. */
async function snapshotAiSettings() {
	const credentials = (
		await db.query(
			"select * from ai_credentials where provider='openai-compatible'",
		)
	).rows[0];
	const defaults = (await db.query("select * from ai_settings where id=1"))
		.rows[0];
	return async () => {
		await db.query(
			"delete from ai_credentials where provider='openai-compatible'",
		);
		await db.query("delete from ai_settings where id=1");
		for (const [table, row] of [
			["ai_credentials", credentials],
			["ai_settings", defaults],
		] as const) {
			if (!row) continue;
			const columns = Object.keys(row);
			await db.query(
				`insert into ${table} (${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
				Object.values(row),
			);
		}
	};
}

/**
 * Configures an OpenAI-compatible provider at an unreachable address as the
 * chat default, so the composer is offered. Replies are faked by routing
 * /api/chat, so no model is ever called.
 */
async function configureFakeChatDefault(page: Page) {
	await page.goto("/settings");
	// The buttons below need the client to have hydrated.
	await page.waitForLoadState("networkidle");
	const provider = page.getByRole("region", {
		name: "OpenAI-compatible credentials",
	});
	const add = provider.getByRole("button", { name: "Add provider" });
	if (await add.count()) await add.click();
	else await provider.getByRole("button", { name: "Replace key" }).click();
	await provider.getByLabel("API key").fill("disposable-e2e-provider-key");
	await provider.getByLabel("Base URL").fill("http://127.0.0.1:1/v1");
	await provider.getByRole("button", { name: "Save provider" }).click();
	await provider.getByRole("button", { name: "Save anyway" }).click();
	await expect(provider.getByText("Configured", { exact: true })).toBeVisible();
	const chatDefault = page.getByRole("region", { name: "Chat default" });
	await chatDefault
		.getByLabel("Provider", { exact: true })
		.selectOption("openai-compatible");
	await chatDefault.getByLabel("Model", { exact: true }).fill("e2e-model");
	await chatDefault.getByRole("button", { name: "Save chat default" }).click();
	await expect(
		chatDefault.getByText("Current: OpenAI-compatible / e2e-model", {
			exact: true,
		}),
	).toBeVisible();
}

/** A book's reading position, put back by the returned function. */
async function snapshotPosition(editionId: string) {
	const saved = (
		await db.query(
			"select max_position, scope_label from reading_positions where edition_id = $1",
			[editionId],
		)
	).rows[0];
	return async () => {
		await db.query("delete from reading_positions where edition_id = $1", [
			editionId,
		]);
		if (saved)
			await db.query(
				"insert into reading_positions (edition_id, max_position, scope_label) values ($1, $2, $3)",
				[editionId, saved.max_position, saved.scope_label],
			);
	};
}

test.describe("Discuss tab", () => {
	const PART_I = "The Communist Manifesto › I: Bourgeois and Proletarians";
	const PART_II = "The Communist Manifesto › II: Proletarians and Communists";
	let restoreAi: (() => Promise<void>) | undefined;

	test.beforeAll(async ({ browser }) => {
		restoreAi = await snapshotAiSettings();
		const context = await browser.newContext({
			baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
		});
		const page = await context.newPage();
		await login(page);
		await configureFakeChatDefault(page);
		await context.close();
	});
	test.afterAll(async () => {
		await restoreAi?.();
	});

	let editionId: string;
	let restorePosition: () => Promise<void>;
	const created: string[] = [];
	test.beforeEach(async ({ page }) => {
		editionId = (await manifesto()).id;
		restorePosition = await snapshotPosition(editionId);
		await db.query("delete from reading_positions where edition_id = $1", [
			editionId,
		]);
		await login(page);
		page.on("framenavigated", (frame) => {
			const id = /\/c\/([0-9a-f-]{36})$/.exec(frame.url())?.[1];
			if (frame === page.mainFrame() && id) created.push(id);
		});
	});
	test.afterEach(async () => {
		await db.query("delete from conversations where id = any($1::uuid[])", [
			created.splice(0),
		]);
		await restorePosition();
	});

	const conversationCount = async () =>
		(
			await one<{ n: number }>(
				"select count(*)::int as n from conversation_editions where edition_id = $1",
				[editionId],
			)
		).n;
	const positionLabel = async () =>
		(
			await one<{ scope_label: string }>(
				"select scope_label from reading_positions where edition_id = $1",
				[editionId],
			)
		).scope_label;
	const composer = (page: Page) => page.getByTestId("book-composer");
	const question = (page: Page) => page.getByLabel("Your question");
	const strip = (page: Page) => page.getByTestId("composer-scope-strip");
	const sheet = (page: Page) => page.getByTestId("composer-scope-sheet");
	const send = (page: Page) =>
		composer(page).getByRole("button", { name: "Send", exact: true }).click();
	const openDiscuss = async (page: Page) => {
		await page.goto(`/books/${editionId}`);
		await page.waitForLoadState("networkidle");
		await expect(composer(page)).toBeVisible();
	};
	/** Picks a unit (by its short label) in the open sheet. */
	const choose = async (page: Page, name: string) => {
		await sheet(page)
			.getByRole("button", { name: /^I'm partway through/ })
			.click();
		await sheet(page).getByRole("radio", { name, exact: true }).check();
	};

	test("dismissing the scope choice on a first question creates nothing", async ({
		page,
	}) => {
		const before = await conversationCount();
		await openDiscuss(page);
		await expect(strip(page)).toHaveAttribute("data-state", "unset");
		await question(page).fill("What is the spectre?");
		await send(page);
		await expect(sheet(page).getByRole("radio").first()).toBeVisible();
		await expect(
			sheet(page).getByRole("radio", { name: "Whole book" }),
		).not.toBeChecked();
		await expect(
			sheet(page).getByRole("radio", { name: "Save as my reading position" }),
		).toBeChecked();
		await expect(
			sheet(page).getByRole("button", { name: "Send" }),
		).toBeDisabled();
		await sheet(page).getByRole("button", { name: "Cancel" }).click();
		await expect(sheet(page)).toBeHidden();
		await expect(page).toHaveURL(`/books/${editionId}`);
		await expect(question(page)).toHaveValue("What is the spectre?");
		expect(await conversationCount()).toBe(before);
	});

	test("a first question saves the position, opens the conversation, and is sent once", async ({
		page,
	}) => {
		let chatRequests = 0;
		await page.route("**/api/chat", (route) => {
			chatRequests++;
			return fulfillReply(route, "The spectre is communism.");
		});
		await openDiscuss(page);
		await question(page).fill("What is the spectre?");
		await send(page);
		await choose(page, "II: Proletarians and Communists");
		await sheet(page).getByRole("button", { name: "Send" }).click();

		await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
		const conversationId = page.url().split("/c/")[1] as string;
		await expect(page.getByText("The spectre is communism.")).toBeVisible();
		await expect(
			page.locator("li").filter({ hasText: "What is the spectre?" }).last(),
		).toBeVisible();
		expect(chatRequests).toBe(1);
		await expect(page.getByTestId("scope-chip")).toHaveText(
			`Through ${PART_II}`,
		);
		expect(await positionLabel()).toBe(PART_II);

		// The reply was faked, so nothing is stored: a resend would show here.
		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
		expect(chatRequests).toBe(1);

		await page.getByRole("link", { name: "← Conversations" }).click();
		await expect(page).toHaveURL(`/books/${editionId}`);
		await expect(page.getByTestId("composer-scope")).toHaveText(
			`Through ${PART_II}`,
		);
		const row = page
			.getByTestId("conversation-row")
			.filter({ has: page.locator(`a[href="/c/${conversationId}"]`) });
		await expect(row.getByTestId("conversation-scope")).toHaveText(
			`Through ${PART_II}`,
		);

		await row.locator(`a[href="/c/${conversationId}"]`).click();
		await expect(page).toHaveURL(`/c/${conversationId}`);
		await page.getByRole("button", { name: /^Widen scope/ }).click();
		const widen = page.getByTestId("widen-scope-dialog");
		await widen.getByRole("button", { name: /^I'm partway through/ }).click();
		await expect(
			widen.getByRole("radio", { name: "I: Bourgeois and Proletarians" }),
		).toHaveCount(0);
		await widen.getByRole("radio", { name: "Whole book" }).check();
		await widen.getByRole("button", { name: "Widen" }).click();
		await expect(widen).toBeHidden();
		await expect(page.getByTestId("scope-chip")).toHaveText("Whole book");
		await expect(page.getByTestId("spoiler-notice")).toBeVisible();
		expect(chatRequests).toBe(1);
	});

	test("a half-written question survives switching tabs", async ({ page }) => {
		const tabs = page.getByRole("navigation", { name: "Book" });
		await openDiscuss(page);
		await question(page).fill("Half a thought");
		await tabs.getByRole("link", { name: "Contents", exact: true }).click();
		await expect(page).toHaveURL(`/books/${editionId}/contents`);
		await tabs.getByRole("link", { name: "Discuss", exact: true }).click();
		await expect(question(page)).toHaveValue("Half a thought");
	});

	test("an earlier scope for one conversation leaves the position; saving it asks first", async ({
		page,
	}) => {
		await page.route("**/api/chat", (route) => fulfillReply(route, "Noted."));
		await openDiscuss(page);
		await strip(page).getByRole("button", { name: "Choose" }).click();
		await choose(page, "II: Proletarians and Communists");
		await sheet(page).getByRole("button", { name: "Use this scope" }).click();
		await expect(sheet(page)).toBeHidden();
		await expect(page.getByTestId("composer-scope")).toHaveText(
			`Through ${PART_II}`,
		);

		// Saving an earlier chapter asks before moving the position back.
		await strip(page).getByRole("button", { name: "Update" }).click();
		await choose(page, "I: Bourgeois and Proletarians");
		await sheet(page).getByRole("button", { name: "Use this scope" }).click();
		const moveBack = page.getByTestId("move-back-dialog");
		await expect(moveBack).toBeVisible();
		await moveBack.getByRole("button", { name: "Keep my position" }).click();
		await expect(moveBack).toBeHidden();
		await sheet(page).getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByTestId("composer-scope")).toHaveText(
			`Through ${PART_II}`,
		);

		// For this conversation only: no confirmation, and the position stays.
		await strip(page).getByRole("button", { name: "Update" }).click();
		await choose(page, "I: Bourgeois and Proletarians");
		await sheet(page)
			.getByRole("radio", { name: "Only for this conversation" })
			.check();
		await sheet(page).getByRole("button", { name: "Use this scope" }).click();
		await expect(sheet(page)).toBeHidden();
		await expect(page.getByTestId("move-back-dialog")).toBeHidden();
		await expect(page.getByTestId("composer-scope")).toHaveText(
			`Through ${PART_I} · this conversation only`,
		);
		await question(page).fill("How does it begin?");
		await send(page);
		await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
		await expect(page.getByTestId("scope-chip")).toHaveText(
			`Through ${PART_I}`,
		);
		expect(await positionLabel()).toBe(PART_II);
	});
});

test.describe("conversation list", () => {
	test.beforeEach(async ({ page }) => login(page));

	test("renames and deletes from a row's menu; a long title truncates beside it", async ({
		page,
	}) => {
		const { id: editionId } = await manifesto();
		const title = `A long conversation title ${"that keeps on going ".repeat(8)}${randomUUID().slice(0, 8)}`;
		const id = await conversation(title);
		await assistantMessage(id, "**Hal** is reading the\n\ndictionary because");
		try {
			await page.goto(`/books/${editionId}`);
			await page.waitForLoadState("networkidle");
			const row = page
				.getByTestId("conversation-row")
				.filter({ has: page.locator(`a[href="/c/${id}"]`) });
			await expect(row.getByTestId("conversation-preview")).toHaveText(
				"Hal is reading the dictionary because",
			);
			const titleText = row.getByTestId("conversation-title");
			expect(
				await titleText.evaluate((el) => el.scrollWidth > el.clientWidth),
			).toBe(true);
			const menu = row.getByRole("button", { name: `Actions for “${title}”` });
			await expect(menu).toBeInViewport();

			await menu.click();
			await page.getByRole("menuitem", { name: "Rename" }).click();
			const rename = page.getByTestId("rename-conversation-dialog");
			await rename.getByLabel("Conversation title").fill("Renamed in a menu");
			await rename.getByRole("button", { name: "Save" }).click();
			await expect(rename).toBeHidden();
			await expect(titleText).toHaveText("Renamed in a menu");

			await row
				.getByRole("button", { name: "Actions for “Renamed in a menu”" })
				.click();
			await page.getByRole("menuitem", { name: "Delete" }).click();
			await page
				.getByRole("alertdialog")
				.getByRole("button", { name: "Delete", exact: true })
				.click();
			await expect(row).toHaveCount(0);
			expect(
				(await db.query("select 1 from conversations where id=$1", [id]))
					.rowCount,
			).toBe(0);
		} finally {
			await db.query("delete from conversations where id=$1", [id]);
		}
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
			await page.waitForLoadState("networkidle");
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
			// A collapsed chip with its excerpt; expanding shows the full quote.
			await expect(chip(page)).toHaveAttribute("data-kind", "quote");
			await expect(page.getByTestId("attachment-excerpt")).toHaveText(
				"A particular claim worth discussing.",
			);
			const toggle = chip(page).getByRole("button", {
				name: /^Show full quote/,
			});
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			await expect(page.getByTestId("reply-quote")).toBeHidden();
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			await expect(page.getByTestId("reply-quote")).toBeVisible();
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
			await expect(chip(page)).toHaveCount(0);
		} finally {
			await db.query("delete from conversations where id=$1", [conversationId]);
		}
	});
});

const passage = async (spine: number, block: number) => {
	const { id } = await manifesto();
	return one<{ locator: string; text: string }>(
		"select locator, text from passages where edition_id = $1 and spine_index = $2 and block_index = $3",
		[id, spine, block],
	);
};

/** The Manifesto's last position in a section, and the scope label for it. */
async function boundThrough(spine: number) {
	const { id: editionId } = await manifesto();
	const bound = await one<{ max: number; title: string }>(
		"select max(p.position) as max, s.title from passages p join sections s on s.id = p.section_id where p.edition_id = $1 and p.spine_index = $2 group by s.title",
		[editionId, spine],
	);
	return {
		max: bound.max,
		label: `The Communist Manifesto › ${bound.title}`,
	};
}

/** A conversation about the Manifesto, optionally bounded through a section's last passage. */
async function conversation(title: string, throughSpine?: number) {
	const { id: editionId } = await manifesto();
	const id = randomUUID();
	const bound =
		throughSpine === undefined ? null : await boundThrough(throughSpine);
	await db.query("insert into conversations (id,title) values ($1,$2)", [
		id,
		title,
	]);
	await db.query(
		"insert into conversation_editions (conversation_id,edition_id,ordinal,max_position,scope_label) values ($1,$2,0,$3,$4)",
		[id, editionId, bound?.max ?? null, bound?.label ?? null],
	);
	return id;
}

/** Stores an assistant message in a conversation, for quoting. */
async function assistantMessage(conversationId: string, text: string) {
	const id = randomUUID();
	await db.query(
		"insert into messages (id,conversation_id,seq,role,parts,finish_reason) values ($1,$2,1,'assistant',$3,'stop')",
		[id, conversationId, JSON.stringify([{ type: "text", text }])],
	);
	return id;
}

/** A complete UI message stream for a one-line reply. */
const replyStream = (text: string) =>
	`data: {"type":"start","messageId":"reply"}\n\ndata: {"type":"text-start","id":"t"}\n\ndata: {"type":"text-delta","id":"t","delta":${JSON.stringify(text)}}\n\ndata: {"type":"text-end","id":"t"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n`;

const fulfillReply = (route: Route, text: string) =>
	route.fulfill({
		status: 200,
		contentType: "text/event-stream",
		headers: { "x-vercel-ai-ui-message-stream": "v1" },
		body: replyStream(text),
	});

const message = (page: Page) => page.getByLabel("Message", { exact: true });
const chip = (page: Page) => page.getByTestId("attachment-chip");
const sendButton = (page: Page) =>
	page.getByRole("button", { name: "Send", exact: true });
const skipWithoutAi = async (page: Page) =>
	test.skip(
		await page.getByText("AI is not configured", { exact: true }).isVisible(),
		"Conversations require configured AI",
	);
const storedDraft = (page: Page, conversationId: string) =>
	page.evaluate(
		(key) => sessionStorage.getItem(key),
		`marginalia:composer:${conversationId}`,
	);

test.describe("passage references", () => {
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
			// Collapsed: the source and a one-line excerpt.
			await expect(chip(page)).toHaveAttribute("data-kind", "passage");
			await expect(chip(page)).toContainText(
				"Passage from the book · The Communist Manifesto · I: Bourgeois and Proletarians",
			);
			await expect(page.getByTestId("attachment-excerpt")).toHaveText(
				"history",
			);
			const quote = page.getByTestId("passage-quote");
			await expect(quote).toBeHidden();
			await expect(message(page)).toHaveValue("My draft");

			// Expanded: the full text and a link into the book.
			const toggle = chip(page).getByRole("button", {
				name: /^Show full passage/,
			});
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			await expect(quote).toBeVisible();
			await expect(quote).toContainText("history");
			await expect(
				chip(page).getByRole("link", { name: "Open in book →" }),
			).toBeVisible();

			// Removing keeps the draft; pasting again attaches a fresh, collapsed chip.
			await chip(page).getByRole("button", { name: "Remove passage" }).click();
			await expect(chip(page)).toHaveCount(0);
			await expect(message(page)).toHaveValue("My draft");
			await paste(`${baseURL}/p/${target.locator}?hl=4-11`);
			await expect(quote).toBeHidden();
			await expect(page.getByTestId("attachment-excerpt")).toHaveText(
				"history",
			);

			const prose = ` and see ${baseURL}/p/${target.locator} too`;
			await message(page).press("End");
			await paste(prose);
			await expect(message(page)).toHaveValue(`My draft${prose}`);
			await expect(page.getByTestId("attachment-excerpt")).toHaveText(
				"history",
			);

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
			await expect(chip(page)).toHaveCount(0);
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
			await expect(chip(page)).toContainText(target.text.slice(0, 30));
			await expect(message(page)).toBeFocused();
			// The handoff is gone from the URL; the reference comes back from the saved draft.
			await expect(page).not.toHaveURL(/ref=/);
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(message(page)).toBeVisible();
			await expect(chip(page)).toHaveCount(1);
			await expect(chip(page)).toContainText(target.text.slice(0, 30));
			await expect(page.getByTestId("passage-status")).toHaveCount(0);
			await expect(sendButton(page)).toHaveAccessibleDescription(
				"Type a message",
			);
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
			await expect(chip(page)).toContainText(later.text.slice(0, 30));
			await expect(notice).toHaveCount(0);
			await expect(message(page)).toHaveValue("Keep me");
		} finally {
			await db.query("delete from conversations where id=$1", [id]);
		}
	});
});

test.describe("composer", () => {
	test.beforeEach(async ({ page, context, baseURL }) => {
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: baseURL,
		});
		await login(page);
	});

	const paste = async (page: Page, text: string) => {
		await page.evaluate((t) => navigator.clipboard.writeText(t), text);
		await message(page).focus();
		await page.keyboard.press("ControlOrMeta+V");
	};

	test("send explains itself, becomes Stop in place, and Escape only clears the attachment", async ({
		page,
		baseURL,
	}) => {
		const target = await passage(5, 2);
		const id = await conversation("Send control test");
		try {
			await page.goto(`/c/${id}`);
			await page.waitForLoadState("networkidle");
			await skipWithoutAi(page);

			await expect(sendButton(page)).toHaveAttribute("aria-disabled", "true");
			await expect(sendButton(page)).toHaveAccessibleDescription(
				"Type a message",
			);
			await expect(page.getByTestId("composer-hint")).toBeVisible();

			// Shift+Enter continues a numbered list; a newline on an empty item ends it.
			await message(page).fill("1. item");
			await message(page).press("End");
			await message(page).press("Shift+Enter");
			await expect(message(page)).toHaveValue("1. item\n2. ");
			await message(page).press("Shift+Enter");
			await expect(message(page)).toHaveValue("1. item\n");
			// Tab outside a list moves focus rather than inserting text.
			await message(page).press("Tab");
			await expect(message(page)).not.toBeFocused();
			await expect(message(page)).toHaveValue("1. item\n");

			await message(page).fill("What is this about?");
			await expect(sendButton(page)).not.toHaveAttribute("aria-disabled");
			const sendBox = await sendButton(page).boundingBox();

			let release = () => {};
			const released = new Promise<void>((resolve) => {
				release = resolve;
			});
			await page.route("**/api/chat", async (route) => {
				await released;
				await fulfillReply(route, "Streamed answer");
			});
			await message(page).press("Enter");
			const stop = page.getByRole("button", { name: "Stop", exact: true });
			await expect(stop).toBeVisible();
			await expect(sendButton(page)).toHaveCount(0);
			const stopBox = await stop.boundingBox();
			expect(Math.abs((stopBox?.x ?? 0) - (sendBox?.x ?? -99))).toBeLessThan(2);
			expect(Math.abs((stopBox?.y ?? 0) - (sendBox?.y ?? -99))).toBeLessThan(2);

			// While the reply is pending, attach a passage and remove it with Escape.
			await message(page).fill("Next question");
			await paste(page, `${baseURL}/p/${target.locator}`);
			await expect(chip(page)).toBeVisible();
			await message(page).press("Escape");
			await expect(chip(page)).toHaveCount(0);
			await expect(message(page)).toHaveValue("Next question");
			await expect(stop).toBeVisible();

			release();
			await expect(page.getByText("Streamed answer")).toBeVisible();
			await expect(sendButton(page)).toBeVisible();
		} finally {
			await db.query("delete from conversations where id=$1", [id]);
		}
	});

	test("a draft and its quote survive a reload until sent", async ({
		page,
	}) => {
		const id = await conversation("Draft reload test");
		const sourceId = await assistantMessage(id, "A claim worth quoting.");
		try {
			await page.goto(`/c/${id}`);
			await page.waitForLoadState("networkidle");
			await skipWithoutAi(page);
			await message(page).fill("Why this claim?");
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
			await expect(chip(page)).toHaveAttribute("data-kind", "quote");

			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(message(page)).toHaveValue("Why this claim?");
			await expect(chip(page)).toHaveAttribute("data-kind", "quote");
			await expect(page.getByTestId("attachment-excerpt")).toHaveText(
				"A claim worth quoting.",
			);

			await page.route("**/api/chat", (route) =>
				fulfillReply(route, "Because."),
			);
			await sendButton(page).click();
			await expect(page.getByText("Because.")).toBeVisible();
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(message(page)).toHaveValue("");
			await expect(chip(page)).toHaveCount(0);
			expect(await storedDraft(page, id)).toBeNull();
		} finally {
			await db.query("delete from conversations where id=$1", [id]);
		}
	});

	test("a restored passage is checked again, and a handoff replaces a restored quote", async ({
		page,
		baseURL,
	}) => {
		const later = await passage(6, 3);
		const id = await conversation("Restored passage test");
		const sourceId = await assistantMessage(id, "Something to quote.");
		try {
			await page.goto(`/c/${id}`);
			await page.waitForLoadState("networkidle");
			await skipWithoutAi(page);
			await message(page).fill("Keep this draft");
			await paste(page, `${baseURL}/p/${later.locator}`);
			await expect(chip(page)).toHaveAttribute("data-kind", "passage");
			await expect.poll(() => storedDraft(page, id)).toContain(later.locator);

			// Narrow the scope so the saved passage falls outside it.
			const bound = await boundThrough(5);
			await db.query(
				"update conversation_editions set max_position=$2, scope_label=$3 where conversation_id=$1",
				[id, bound.max, bound.label],
			);
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(page.getByTestId("passage-status")).toContainText(
				"beyond this conversation's scope",
			);
			await expect(chip(page)).toHaveCount(0);
			await expect(message(page)).toHaveValue("Keep this draft");

			// A saved quote is restored, then replaced by a reference handed over from the passage view.
			const inScope = await passage(5, 2);
			await page.evaluate(
				([key, value]) => sessionStorage.setItem(key, value),
				[
					`marginalia:composer:${id}`,
					JSON.stringify({
						v: 1,
						text: "Restored draft",
						attachment: {
							kind: "quote",
							messageId: sourceId,
							text: "Something to quote.",
						},
					}),
				] as const,
			);
			await page.reload();
			await expect(chip(page)).toHaveAttribute("data-kind", "quote");
			await page.goto(`/c/${id}?ref=${encodeURIComponent(inScope.locator)}`);
			await expect(chip(page)).toHaveAttribute("data-kind", "passage");
			await expect(chip(page)).toContainText(inScope.text.slice(0, 20));
			await expect(message(page)).toHaveValue("Restored draft");
		} finally {
			await db.query("delete from conversations where id=$1", [id]);
		}
	});

	test("deleting a conversation clears its draft; a corrupt draft is ignored", async ({
		page,
	}) => {
		const title = `Draft delete test ${randomUUID().slice(0, 8)}`;
		const id = await conversation(title);
		try {
			await page.goto(`/c/${id}`);
			await page.waitForLoadState("networkidle");
			await skipWithoutAi(page);

			await page.evaluate(
				(key) => sessionStorage.setItem(key, "{not json"),
				`marginalia:composer:${id}`,
			);
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(message(page)).toHaveValue("");
			await expect(chip(page)).toHaveCount(0);

			await message(page).fill("Unsent thought");
			await expect
				.poll(() => storedDraft(page, id))
				.toContain("Unsent thought");
			await page.getByRole("button", { name: `Delete “${title}”` }).click();
			await page.getByRole("button", { name: "Delete", exact: true }).click();
			await expect(page).toHaveURL(/\/books\/[0-9a-f-]{36}$/);
			expect(await storedDraft(page, id)).toBeNull();
		} finally {
			await db.query("delete from conversations where id=$1", [id]);
		}
	});

	test("sent messages render Markdown but not HTML", async ({ page }) => {
		const id = await conversation("Markdown test");
		try {
			await page.goto(`/c/${id}`);
			await page.waitForLoadState("networkidle");
			await skipWithoutAi(page);
			await page.route("**/api/chat", (route) => fulfillReply(route, "Noted."));
			await message(page).fill(
				"Two points:\n\n1. first point\n2. second point\n\n<b>bold?</b>",
			);
			await sendButton(page).click();
			await expect(page.getByText("Noted.")).toBeVisible();
			const sent = page.locator("li").filter({ hasText: "Two points:" }).last();
			await expect(sent.locator("ol li")).toHaveText([
				"first point",
				"second point",
			]);
			await expect(sent.getByText("<b>bold?</b>")).toBeVisible();
			await expect(sent.locator("b")).toHaveCount(0);
		} finally {
			await db.query("delete from conversations where id=$1", [id]);
		}
	});
});

// Requires an isolated e2e instance with MARGINALIA_SECRET_KEY configured.
test("Settings adds a provider and a chat default used by a new conversation", async ({
	page,
}) => {
	const originalCredentials = (
		await db.query(
			"select * from ai_credentials where provider='openai-compatible'",
		)
	).rows[0];
	const originalDefaults = (
		await db.query("select * from ai_settings where id=1")
	).rows[0];
	let conversationId: string | undefined;
	try {
		await login(page);
		await page.goto("/settings");
		const provider = page.getByRole("region", {
			name: "OpenAI-compatible credentials",
		});
		const add = provider.getByRole("button", { name: "Add provider" });
		if (await add.count()) await add.click();
		else await provider.getByRole("button", { name: "Replace key" }).click();
		await provider.getByLabel("API key").fill("disposable-e2e-provider-key");
		await provider.getByLabel("Base URL").fill("http://127.0.0.1:1/v1");
		await provider.getByRole("button", { name: "Save provider" }).click();
		await provider.getByRole("button", { name: "Save anyway" }).click();
		await expect(
			provider.getByText("Configured", { exact: true }),
		).toBeVisible();
		const chatDefault = page.getByRole("region", { name: "Chat default" });
		await chatDefault
			.getByLabel("Provider", { exact: true })
			.selectOption("openai-compatible");
		await chatDefault.getByLabel("Model", { exact: true }).fill("e2e-model");
		await chatDefault
			.getByRole("button", { name: "Save chat default" })
			.click();
		await expect(
			chatDefault.getByText("Current: OpenAI-compatible / e2e-model", {
				exact: true,
			}),
		).toBeVisible();
		const { id } = await manifesto();
		// The reply is faked, so the test never calls an AI model.
		await page.route("**/api/chat", (route) => fulfillReply(route, "Noted."));
		await page.goto(`/books/${id}`);
		await page.waitForLoadState("networkidle");
		const composer = page.getByTestId("book-composer");
		await expect(composer.getByTestId("book-composer-model")).toContainText(
			"OpenAI-compatible / e2e-model",
		);
		// Whole book for this conversation only, whatever the reading position.
		await composer
			.getByTestId("composer-scope-strip")
			.getByRole("button", { name: /^(Update|Choose)$/ })
			.click();
		const sheet = page.getByTestId("composer-scope-sheet");
		await sheet.getByRole("radio", { name: /^Whole book/ }).check();
		await sheet
			.getByRole("radio", { name: "Only for this conversation" })
			.check();
		await sheet.getByRole("button", { name: "Use this scope" }).click();
		await page.getByLabel("Your question").fill("Which model is this?");
		await composer.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
		conversationId = page.url().split("/c/")[1];
		await expect(page.getByText("Noted.")).toBeVisible();
		await expect(page.getByTestId("provider-label")).toContainText(
			"OpenAI-compatible / e2e-model",
		);
		await expect(page.getByTestId("model-source")).toHaveText("default");
	} finally {
		if (conversationId)
			await db.query("delete from conversations where id=$1", [conversationId]);
		await db.query(
			"delete from ai_credentials where provider='openai-compatible'",
		);
		await db.query("delete from ai_settings where id=1");
		for (const [table, row] of [
			["ai_credentials", originalCredentials],
			["ai_settings", originalDefaults],
		] as const) {
			if (!row) continue;
			const columns = Object.keys(row);
			await db.query(
				`insert into ${table} (${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
				Object.values(row),
			);
		}
	}
});

/**
 * Phone widths (360 and 390 CSS pixels, touch). Sizes are read from bounding
 * boxes; there are no pixel baselines.
 */
test.describe("phone layout", () => {
	test.use({
		viewport: { width: 360, height: 800 },
		hasTouch: true,
		isMobile: true,
	});

	/** Nothing extends past the right edge, so there is no sideways page scroll. */
	const expectNoHorizontalScroll = async (page: Page) =>
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth,
			),
		).toBeLessThanOrEqual(0);
	/** A touch target of at least 44 by 44 CSS pixels. */
	const expectTouchTarget = async (target: Locator) => {
		const box = await target.boundingBox();
		expect(box?.width).toBeGreaterThanOrEqual(44);
		expect(box?.height).toBeGreaterThanOrEqual(44);
	};
	const lineHeightOf = (target: Locator) =>
		target.evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight));

	test("the unprotected notice takes one line", async ({ page }) => {
		test.skip(Boolean(PASSWORD), "Needs an instance without a password");
		await page.goto("/");
		const notice = page.getByTestId("unprotected-notice");
		await expect(notice).toBeVisible();
		await expect(notice).toHaveAttribute(
			"title",
			"No password set: anyone who can reach this instance can use it.",
		);
		// The text inside the padding is a single line.
		const textHeight = await notice.evaluate((el) => {
			const style = getComputedStyle(el);
			return (
				el.clientHeight -
				Number.parseFloat(style.paddingTop) -
				Number.parseFloat(style.paddingBottom)
			);
		});
		expect(textHeight).toBeLessThan((await lineHeightOf(notice)) * 1.5);
		await expectNoHorizontalScroll(page);
	});

	test.describe("signed in", () => {
		let restoreAi: (() => Promise<void>) | undefined;
		test.beforeAll(async ({ browser }) => {
			restoreAi = await snapshotAiSettings();
			const context = await browser.newContext({
				baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
			});
			const page = await context.newPage();
			await login(page);
			await configureFakeChatDefault(page);
			await context.close();
		});
		test.afterAll(async () => {
			await restoreAi?.();
		});
		test.beforeEach(async ({ page }) => login(page));

		test("the app header is one row of named icon controls", async ({
			page,
		}) => {
			const brand = page.getByRole("link", { name: "Marginalia" });
			const settings = page.getByRole("link", { name: "Settings" });
			const logOut = page.getByRole("button", { name: "Log out" });
			await expect(settings).toBeVisible();
			await expect(logOut).toBeVisible();
			await expectTouchTarget(settings);
			await expectTouchTarget(logOut);
			const middles = await Promise.all(
				[brand, settings, logOut].map(async (l) => {
					const b = await l.boundingBox();
					return (b?.y ?? 0) + (b?.height ?? 0) / 2;
				}),
			);
			for (const m of middles)
				expect(Math.abs(m - (middles[0] ?? 0))).toBeLessThan(2);
			const row = page.locator("body > div > header > div").first();
			expect((await row.boundingBox())?.height).toBeLessThan(80);
			await expectNoHorizontalScroll(page);
		});

		test("the library shows two books a row, one row of filters, and the upload", async ({
			page,
		}) => {
			// Two columns, whether or not the library holds a second book yet.
			const grid = page.locator("main ul").first();
			await expect(grid.locator("> li").first()).toBeVisible();
			expect(
				await grid.evaluate(
					(el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
				),
			).toBe(2);
			expect(
				(await grid.locator("> li").first().boundingBox())?.width,
			).toBeLessThan(360 / 2);

			const filters = page.getByTestId("status-filter").getByRole("button");
			const count = await filters.count();
			expect(count).toBeGreaterThan(1);
			const first = await filters.first().boundingBox();
			for (let i = 0; i < count; i++) {
				const filter = filters.nth(i);
				expect((await filter.boundingBox())?.y).toBe(first?.y);
				await filter.scrollIntoViewIfNeeded();
				await expect(filter).toBeInViewport({ ratio: 1 });
				await expectTouchTarget(filter);
			}
			await page.evaluate(() => window.scrollTo(0, 0));
			await expect(
				page.getByRole("button", { name: "Upload EPUB" }),
			).toBeInViewport({ ratio: 1 });
			await expectNoHorizontalScroll(page);
		});

		test("every book tab fits, and Discuss shows the book, position, and composer first", async ({
			page,
		}, testInfo) => {
			const { id } = await manifesto();
			const tabs = page.getByRole("navigation", { name: "Book" });
			for (const path of ["", "/guide", "/contents", "/about"]) {
				await page.goto(`/books/${id}${path}`);
				await expect(tabs).toBeVisible();
				await expectNoHorizontalScroll(page);
			}
			const links = tabs.getByRole("link");
			const top = (await links.first().boundingBox())?.y;
			for (let i = 0; i < (await links.count()); i++) {
				const box = await links.nth(i).boundingBox();
				expect(box?.y).toBe(top);
				expect(box?.height).toBeGreaterThanOrEqual(44);
			}
			expect(await tabs.evaluate((el) => getComputedStyle(el).overflowX)).toBe(
				"auto",
			);

			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`/books/${id}`);
			await page.waitForLoadState("networkidle");
			const composer = page.getByTestId("book-composer");
			await expect(composer).toBeVisible();
			await page.screenshot({ path: testInfo.outputPath("discuss-390.png") });
			for (const part of [
				page.getByRole("heading", { level: 1 }),
				page.getByTestId("reading-position"),
				composer.getByLabel("Your question"),
				composer.getByRole("button", { name: "Send", exact: true }),
			]) {
				await expect(part).toBeInViewport({ ratio: 1 });
			}
			await expectNoHorizontalScroll(page);
		});

		test("a conversation keeps a short header with its controls one tap away", async ({
			page,
		}, testInfo) => {
			const title = `A phone conversation ${"with a title that runs on ".repeat(4)}${randomUUID().slice(0, 8)}`;
			const id = await conversation(title, 2);
			try {
				await page.goto(`/c/${id}`);
				await page.waitForLoadState("networkidle");
				const header = page.getByTestId("chat-header");
				const heading = page.getByRole("heading", { level: 1 });
				await expect(heading).toHaveAttribute("title", title);
				expect(
					await heading.evaluate((el) => el.scrollWidth > el.clientWidth),
				).toBe(true);
				const books = page.getByTestId("conversation-books");
				expect((await books.boundingBox())?.height).toBeLessThan(
					(await lineHeightOf(books)) * 1.5,
				);
				expect((await header.boundingBox())?.height).toBeLessThanOrEqual(
					800 / 4,
				);

				const toggle = header.getByRole("button", { name: "Scope and model" });
				await expect(toggle).toHaveAttribute("aria-expanded", "false");
				await page.screenshot({
					path: testInfo.outputPath("conversation-360.png"),
				});
				await expectTouchTarget(toggle);
				await expect(page.getByTestId("scope-chip")).toBeHidden();
				await toggle.click();
				await expect(toggle).toHaveAttribute("aria-expanded", "true");
				await expect(page.getByTestId("scope-chip")).toBeVisible();
				await expect(
					page.getByRole("button", { name: /^Widen scope/ }),
				).toBeVisible();
				await expect(
					page.getByRole("button", { name: "Change model" }),
				).toBeVisible();
				await expectNoHorizontalScroll(page);

				// The composer stays docked in view, also once the keyboard shrinks the viewport.
				const input = message(page);
				await expect(input).toBeInViewport({ ratio: 1 });
				await input.focus();
				await page.setViewportSize({ width: 360, height: 420 });
				await expect(input).toBeInViewport({ ratio: 1 });
			} finally {
				await db.query("delete from conversations where id=$1", [id]);
			}
		});

		test("no page scrolls sideways: library, each book tab, a conversation, and settings", async ({
			page,
		}) => {
			const { id: editionId } = await manifesto();
			const id = await conversation(
				`A narrow conversation ${randomUUID().slice(0, 8)}`,
				2,
			);
			try {
				for (const path of [
					"/",
					`/books/${editionId}`,
					`/books/${editionId}/guide`,
					`/books/${editionId}/contents`,
					`/books/${editionId}/about`,
					`/c/${id}`,
					"/settings",
				]) {
					await page.goto(path);
					await page.waitForLoadState("networkidle");
					const overflow = await page.evaluate(() => {
						const el = document.scrollingElement ?? document.documentElement;
						return el.scrollWidth - el.clientWidth;
					});
					expect(overflow, `sideways overflow on ${path}`).toBeLessThanOrEqual(
						0,
					);
				}
			} finally {
				await db.query("delete from conversations where id=$1", [id]);
			}
		});

		test("the scope sheet for a 200-chapter book scrolls and keeps its actions reachable", async ({
			page,
		}, testInfo) => {
			test.setTimeout(120_000);
			const title = `E2E Long Book ${randomUUID().slice(0, 8)}`;
			const bytes = await buildEpub({
				title,
				creators: ["Test Author"],
				chapters: Array.from({ length: 200 }, (_, i) => ({
					href: `c${i}.xhtml`,
					title: `Chapter ${i + 1}`,
					body: `<p>Paragraph of chapter ${i + 1}.</p>`,
				})),
			});
			await searchLibrary(page, title);
			await page.locator("#upload").setInputFiles({
				name: "long.epub",
				mimeType: "application/epub+zip",
				buffer: bytes,
			});
			const card = page.getByRole("listitem").filter({ hasText: title });
			await expect(card.getByText("Not started")).toBeVisible({
				timeout: 60_000,
			});
			const { id } = await one<{ id: string }>(
				"select id from editions where title = $1",
				[title],
			);

			await page.goto(`/books/${id}`);
			await page.waitForLoadState("networkidle");
			const composer = page.getByTestId("book-composer");
			await composer
				.getByLabel("Your question")
				.fill("What is in chapter 200?");
			await composer.getByRole("button", { name: "Send", exact: true }).click();
			const sheet = page.getByTestId("composer-scope-sheet");
			await sheet.getByRole("button", { name: /^I'm partway through/ }).click();
			const last = sheet.getByRole("radio", {
				name: "Chapter 200",
				exact: true,
			});
			await expect(last).toBeAttached();
			const box = await sheet.boundingBox();
			expect(box?.y).toBeGreaterThanOrEqual(0);
			expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(800);
			const send = sheet.getByRole("button", { name: "Send" });
			const cancel = sheet.getByRole("button", { name: "Cancel" });
			await expect(send).toBeInViewport({ ratio: 1 });
			await expect(cancel).toBeInViewport({ ratio: 1 });

			// The 200 choices scroll inside the sheet; the actions stay put.
			const list = last.locator(
				"xpath=ancestor::*[contains(@class, 'overflow-y-auto')][1]",
			);
			expect(
				await list.evaluate((el) => el.scrollHeight > el.clientHeight),
			).toBe(true);
			await last.scrollIntoViewIfNeeded();
			await last.check();
			await expect(send).toBeInViewport({ ratio: 1 });
			await expect(send).toBeEnabled();
			await page.screenshot({
				path: testInfo.outputPath("scope-sheet-360.png"),
			});
			await expectNoHorizontalScroll(page);
			await cancel.click();
			await expect(sheet).toBeHidden();
		});
	});
});
