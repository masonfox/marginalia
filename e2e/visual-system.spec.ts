import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import pg from "pg";

/**
 * Read-only visual review against an already running instance:
 * pnpm exec playwright test e2e/visual-system.spec.ts --project=chromium --workers=1 --output=test-results/visual-system-run
 * E2E_DATABASE_URL selects existing fixtures through SELECT-only connections.
 * Optional overrides: E2E_VISUAL_EDITION_ID, E2E_VISUAL_CONVERSATION_ID,
 * E2E_VISUAL_CITATION_CONVERSATION_ID, E2E_VISUAL_READER_LOCATOR.
 * E2E_PASSWORD is needed when the instance requires a password.
 * No EPUB imports, position saves, provider calls, or settings writes occur.
 * For populated states, use a library with reading positions and completed
 * Guide data, and a conversation with stored messages and verified citations.
 * Missing content fixtures produce explicit skips, never invented content.
 */
const themes = ["light", "sepia", "dark"] as const;
const widths = [1440, 390, 360] as const;
type Theme = (typeof themes)[number];
const PASSWORD = process.env.E2E_PASSWORD;
const db = process.env.E2E_DATABASE_URL
	? new pg.Pool({
			connectionString: process.env.E2E_DATABASE_URL,
			options: "-c default_transaction_read_only=on",
			max: 1,
		})
	: undefined;

interface Fixtures {
	edition?: { id: string; title: string };
	additionalEdition?: { id: string; title: string };
	conversationId?: string;
	citationConversationId?: string;
	readerLocator?: string;
}
let fixtures: Fixtures = {};
test.use({ reducedMotion: "reduce", timezoneId: "America/New_York" });

test.beforeAll(async () => {
	if (!db) return;
	const citation = await db.query<{ id: string }>(
		`select c.id from conversations c
     where ($1::uuid is null or c.id = $1::uuid)
     and exists (
       select 1 from messages m, jsonb_array_elements(m.citations) citation
       where m.conversation_id = c.id and m.role = 'assistant'
       and m.parts::text like '%[[cite%'
       and citation->>'status' = 'verified'
       and coalesce(citation->>'currentLocator', '') <> ''
       and exists (select 1 from conversation_editions ce
         where ce.conversation_id = c.id
         and ce.edition_id::text = citation->>'editionId')
     ) order by c.updated_at desc, c.id limit 1`,
		[process.env.E2E_VISUAL_CITATION_CONVERSATION_ID ?? null],
	);
	const conversation = await db.query<{ id: string }>(
		`select c.id from conversations c
     where ($1::uuid is null or c.id = $1::uuid)
     and exists (select 1 from messages m where m.conversation_id = c.id)
     and exists (select 1 from conversation_editions ce where ce.conversation_id = c.id)
     order by (c.id = $2::uuid) desc, c.updated_at desc, c.id limit 1`,
		[
			process.env.E2E_VISUAL_CONVERSATION_ID ?? null,
			citation.rows[0]?.id ?? null,
		],
	);
	const edition = await db.query<{ id: string; title: string }>(
		`select e.id, e.title from editions e
     where e.status = 'ready' and ($1::uuid is null or e.id = $1::uuid)
     and exists (select 1 from passages p where p.edition_id = e.id and p.position is not null)
     order by exists (select 1 from unit_summaries us where us.edition_id = e.id and not us.stale) desc,
     exists (select 1 from reading_positions rp where rp.edition_id = e.id and rp.max_position is not null) desc,
     (e.title = 'The Communist Manifesto') desc, e.id limit 1`,
		[process.env.E2E_VISUAL_EDITION_ID ?? null],
	);
	const passage = edition.rows[0]
		? await db.query<{ locator: string }>(
				`select locator from passages where edition_id = $1 and position is not null
         and kind = 'paragraph' and length(text) > 80
         order by (locator in (select citation->>'currentLocator'
           from messages m, jsonb_array_elements(m.citations) citation
           where citation->>'status' = 'verified')) desc, position limit 1`,
				[edition.rows[0].id],
			)
		: undefined;
	const additional = edition.rows[0]
		? await db.query<{ id: string; title: string }>(
				`select e.id, e.title from editions e where e.status = 'ready' and e.id <> $1
				 and exists (select 1 from passages p where p.edition_id = e.id)
				 order by exists (select 1 from unit_summaries us where us.edition_id = e.id) desc,
				 length(e.title) desc, e.id limit 1`,
				[edition.rows[0].id],
			)
		: undefined;
	fixtures = {
		edition: edition.rows[0],
		additionalEdition: additional?.rows[0],
		conversationId: conversation.rows[0]?.id,
		citationConversationId: citation.rows[0]?.id,
		readerLocator:
			process.env.E2E_VISUAL_READER_LOCATOR ?? passage?.rows[0]?.locator,
	};
});
test.afterAll(async () => {
	await db?.end();
});

async function prepare(page: Page, theme: Theme, width: number) {
	await page.setViewportSize({ width, height: width >= 640 ? 1000 : 844 });
	await page.addInitScript((choice) => {
		localStorage.setItem("marginalia:theme", choice);
	}, theme);
	// Block chat even if an unexpected regression tries to submit it.
	await page.route("**/api/chat", (route) => route.abort("blockedbyclient"));
}
async function login(page: Page) {
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	if (new URL(page.url()).pathname !== "/login") return;
	expect(
		PASSWORD,
		"Set E2E_PASSWORD to the running instance's password",
	).toBeTruthy();
	await page.getByLabel("Password", { exact: true }).fill(PASSWORD ?? "");
	await page.getByRole("button", { name: "Log in", exact: true }).click();
	await expect(page).toHaveURL((url) => url.pathname === "/");
	await page.waitForLoadState("networkidle");
}
async function settled(page: Page, theme: Theme) {
	await page.waitForLoadState("networkidle");
	await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
	await expect(
		page.getByRole("heading", { name: "Not found", exact: true }),
	).toHaveCount(0);
	await page.evaluate(async () => {
		await document.fonts.ready;
		// decode() alone never settles for a lazy image outside the viewport.
		// Request real cover images before capturing the full-page screenshot.
		for (const image of document.images) image.loading = "eager";
		await Promise.race([
			Promise.all(
				[...document.images].map((image) => image.decode().catch(() => {})),
			),
			new Promise((resolve) => setTimeout(resolve, 5000)),
		]);
	});
}
async function noHorizontalScroll(page: Page) {
	const overflow = await page.evaluate(() => {
		const root = document.scrollingElement ?? document.documentElement;
		return root.scrollWidth - root.clientWidth;
	});
	expect(
		overflow,
		`horizontal overflow at ${page.viewportSize()?.width}px on ${page.url()}`,
	).toBeLessThanOrEqual(0);
}
async function screenshot(
	page: Page,
	info: TestInfo,
	name: string,
	fullPage = true,
) {
	// Explicit ignored root: never emit screenshot baselines into the source tree.
	const directory = path.resolve(
		"test-results",
		"visual-system",
		info.project.name,
	);
	await mkdir(directory, { recursive: true });
	const file = path.join(directory, `${name}.png`);
	await page.screenshot({
		path: file,
		fullPage,
		animations: "disabled",
		caret: "hide",
	});
	await info.attach(name, { path: file, contentType: "image/png" });
}
interface Screen {
	name: string;
	fixture?: "edition" | "conversationId" | "readerLocator";
	url: () => string;
	dialog?: boolean;
	loggedOut?: boolean;
}
const screens: Screen[] = [
	{ name: "dashboard", url: () => "/" },
	{ name: "library", url: () => "/library" },
	{ name: "conversations", url: () => "/conversations" },
	{
		name: "book-discuss",
		fixture: "edition",
		url: () => `/books/${fixtures.edition?.id}`,
	},
	{
		name: "book-guide",
		fixture: "edition",
		url: () => `/books/${fixtures.edition?.id}/guide`,
	},
	{
		name: "book-contents",
		fixture: "edition",
		url: () => `/books/${fixtures.edition?.id}/contents`,
	},
	{
		name: "book-about",
		fixture: "edition",
		url: () => `/books/${fixtures.edition?.id}/about`,
	},
	{
		name: "conversation",
		fixture: "conversationId",
		url: () => `/c/${fixtures.conversationId}`,
	},
	{
		name: "new-conversation",
		fixture: "edition",
		url: () => "/library",
		dialog: true,
	},
	{
		name: "reader",
		fixture: "readerLocator",
		url: () => `/p/${encodeURIComponent(fixtures.readerLocator ?? "")}`,
	},
	{ name: "settings", url: () => "/settings" },
	{ name: "login", url: () => "/login", loggedOut: true },
];

for (const theme of themes) {
	test(`new-conversation keyboard short-height ${theme} 360`, async ({
		page,
	}, info) => {
		test.skip(
			!fixtures.edition || !fixtures.additionalEdition,
			"Two existing ready books with reading units are needed",
		);
		await prepare(page, theme, 360);
		await login(page);
		await page.goto("/library");
		await settled(page, theme);
		const writes: string[] = [];
		page.on("request", (request) => {
			if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
				writes.push(request.url());
		});
		await page
			.getByRole("button", { name: "New conversation", exact: true })
			.click();
		const dialog = page.getByTestId("header-new-conversation-dialog");
		for (const book of [fixtures.edition, fixtures.additionalEdition]) {
			if (!book) throw new Error("Missing ready book fixture");
			await dialog
				.getByRole("button", { name: "Add book", exact: true })
				.click();
			const picker = page.getByTestId("book-picker");
			await picker
				.getByRole("searchbox", { name: "Search books" })
				.fill(book.title);
			await picker
				.getByTestId("book-picker-option")
				.filter({ hasText: book.title })
				.first()
				.click();
			await expect(picker).toBeHidden();
			const row = dialog.locator(
				`[data-testid="composer-book"][data-edition-id="${book.id}"]`,
			);
			await row.getByRole("button", { name: "Update", exact: true }).click();
			const sheet = page.getByTestId("composer-scope-sheet");
			// These choices remain client-side; never save shared reading positions.
			await sheet
				.getByRole("radio", { name: "Only for this conversation", exact: true })
				.check();
			await sheet.getByRole("button", { name: /^I'm partway through/ }).click();
			const choices = sheet.locator('input[type="radio"][value^="unit:"]');
			await expect(choices.first()).toBeAttached();
			const index = await choices.evaluateAll((elements) =>
				elements.reduce(
					(longest, element, i) =>
						(element.getAttribute("aria-label")?.length ?? 0) >
						(elements[longest]?.getAttribute("aria-label")?.length ?? 0)
							? i
							: longest,
					0,
				),
			);
			await choices.nth(index).check();
			await expect(
				sheet.getByRole("radio", {
					name: "Only for this conversation",
					exact: true,
				}),
			).toBeChecked();
			await sheet
				.getByRole("button", { name: "Use this scope", exact: true })
				.click();
			await expect(sheet).toBeHidden();
		}
		const question = dialog.getByLabel("Your question", { exact: true });
		await question.fill("What is happening in this passage?");
		await page.setViewportSize({ width: 360, height: 500 });
		await question.focus();
		const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
		const start = dialog.getByRole("button", {
			name: "Start conversation",
			exact: true,
		});
		await expect(start).toBeEnabled();
		let reachedStart = false;
		for (let i = 0; i < 20; i++) {
			await page.keyboard.press("Tab");
			await expect(cancel).toBeInViewport();
			if (
				await start.evaluate((element) => document.activeElement === element)
			) {
				reachedStart = true;
				break;
			}
		}
		expect(reachedStart, "Tab reaches Start without sending a question").toBe(
			true,
		);
		await expect(start).toBeInViewport({ ratio: 1 });
		expect(
			await page
				.getByTestId("new-conversation-body")
				.evaluate((element) => element.scrollTop),
		).toBeGreaterThan(0);
		await noHorizontalScroll(page);
		await screenshot(
			page,
			info,
			`new-conversation-keyboard-${theme}-360x500`,
			false,
		);
		await cancel.click();
		await expect(dialog).toBeHidden();
		expect(
			writes,
			"Draft-only keyboard checks must not write data or call AI",
		).toEqual([]);
	});
	for (const width of widths) {
		for (const screen of screens) {
			test(`${screen.name} ${theme} ${width}${width === 360 ? " overflow" : " screenshot"}`, async ({
				page,
			}, info) => {
				test.skip(
					Boolean(screen.fixture && !fixtures[screen.fixture]),
					`Missing existing ${screen.fixture}; set E2E_DATABASE_URL and optional E2E_VISUAL_* fixture overrides`,
				);
				const errors: string[] = [];
				const chatRequests: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				page.on("request", (request) => {
					if (new URL(request.url()).pathname === "/api/chat")
						chatRequests.push(request.url());
				});
				info.annotations.push({
					type: "fixtures",
					description: JSON.stringify(fixtures),
				});
				await prepare(page, theme, width);
				if (!screen.loggedOut) await login(page);
				await page.goto(screen.url());
				await settled(page, theme);
				if (screen.loggedOut) {
					test.skip(
						new URL(page.url()).pathname !== "/login",
						"Login screen requires an instance with AUTH_PASSWORD enabled",
					);
					await expect(
						page.getByLabel("Password", { exact: true }),
					).toBeVisible();
				} else {
					await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
				}
				if (screen.dialog) {
					await page
						.getByRole("button", { name: "New conversation", exact: true })
						.click();
					const dialog = page.getByTestId("header-new-conversation-dialog");
					await expect(dialog).toBeVisible();
					await expect(dialog.getByTestId("book-composer")).toBeVisible();
					await dialog
						.getByRole("button", { name: "Add book", exact: true })
						.click();
					const picker = page.getByTestId("book-picker");
					await picker
						.getByRole("searchbox", { name: "Search books" })
						.fill(fixtures.edition?.title ?? "");
					const option = picker
						.getByTestId("book-picker-option")
						.filter({ hasText: fixtures.edition?.title });
					await expect(option.first()).toBeVisible();
					await option.first().click();
					await expect(picker).toBeHidden();
					await expect(dialog.getByTestId("composer-book")).toBeVisible();
					await expect(dialog.getByTestId("composer-book-cover")).toBeVisible();
					await expect(
						dialog.getByRole("button", { name: "Cancel", exact: true }),
					).toBeInViewport();
					await settled(page, theme);
				}
				await noHorizontalScroll(page);
				if (screen.name === "dashboard" || screen.name === "conversations") {
					for (const preview of await page
						.getByTestId("conversation-preview")
						.all()) {
						const layout = await preview.evaluate((element) => {
							const style = getComputedStyle(element);
							return {
								clamp: style.webkitLineClamp,
								height: element.getBoundingClientRect().height,
								lineHeight: Number.parseFloat(style.lineHeight),
							};
						});
						expect(layout.clamp).toBe("2");
						expect(
							layout.height,
							"Recent previews occupy at most two lines",
						).toBeLessThanOrEqual(layout.lineHeight * 2 + 1);
					}
				}
				if (width !== 360)
					await screenshot(
						page,
						info,
						`${screen.name}-${theme}-${width}`,
						!screen.dialog,
					);
				expect(errors).toEqual([]);
				expect(
					chatRequests,
					"Visual browsing must never submit an AI request",
				).toEqual([]);
			});
		}
	}
	for (const width of widths) {
		test(`dashboard new-conversation ${theme} ${width}`, async ({
			page,
		}, info) => {
			await prepare(page, theme, width);
			await login(page);
			const hero = page.locator(
				'section[aria-labelledby="continue-reading-title"]',
			);
			test.skip(
				(await hero.count()) === 0,
				"Dashboard dialog requires an existing in-progress reading position",
			);
			const title = await hero.getByRole("heading", { level: 1 }).innerText();
			const trigger = hero.getByRole("button", {
				name: "New conversation",
				exact: true,
			});
			await trigger.click();
			const dialog = page.getByTestId("header-new-conversation-dialog");
			await expect(dialog.getByTestId("composer-book-title")).toHaveText(title);
			await expect(
				dialog.getByLabel("Your question", { exact: true }),
			).toHaveValue("");
			await expect(dialog.getByTestId("composer-book-cover")).toBeVisible();
			await expect(
				dialog.getByRole("button", { name: "Cancel", exact: true }),
			).toBeInViewport();
			await settled(page, theme);
			await noHorizontalScroll(page);
			if (width !== 360)
				await screenshot(
					page,
					info,
					`dashboard-new-conversation-${theme}-${width}`,
					false,
				);
			await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect(trigger).toBeFocused();
		});
	}
	for (const width of [390, 360]) {
		test(`citation bottom sheet ${theme} ${width}`, async ({ page }, info) => {
			test.skip(
				!fixtures.citationConversationId,
				"No existing conversation with a stored verified citation; supply E2E_VISUAL_CITATION_CONVERSATION_ID and E2E_DATABASE_URL",
			);
			await prepare(page, theme, width);
			await login(page);
			await page.goto(`/c/${fixtures.citationConversationId}`);
			await settled(page, theme);
			const citation = page
				.locator('button[data-citation-status="verified"]')
				.first();
			await expect(
				citation,
				"Stored citation must also have a live rendered marker",
			).toBeVisible();
			await citation.click();
			const sheet = page.getByRole("dialog", { name: /^Source \d+$/ });
			await expect(sheet).toBeVisible();
			const box = await sheet.boundingBox();
			expect(box).not.toBeNull();
			if (!box) throw new Error("Citation sheet has no layout box");
			expect(
				Math.abs(box.y + box.height - 844),
				"Citation sheet touches viewport bottom",
			).toBeLessThanOrEqual(1);
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(width);
			await expect(
				sheet.getByRole("button", { name: "Close", exact: true }),
			).toBeInViewport();
			await noHorizontalScroll(page);
			await screenshot(page, info, `citation-sheet-${theme}-${width}`, false);
			await page.keyboard.press("Escape");
			await expect(sheet).toBeHidden();
			await expect(citation).toBeFocused();
		});
	}
}
