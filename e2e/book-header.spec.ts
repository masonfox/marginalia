import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { buildEpub } from "../test/epub-builder";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });

test.afterAll(async () => {
	await db.end();
});

async function login(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL("/");
	await page.waitForLoadState("networkidle");
}

const LONG =
	"Winter Barley, and the Long Argument in the Kitchen About Whether the Frost Would Hold Until the Spring Ploughing";

// A 1x1 PNG, so the phone header has a cover beside the title like a real book.
const PIXEL = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

test("the book header shows a long reading-position label in full on desktop, tablets and phones", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));
	await page.setViewportSize({ width: 1280, height: 800 });
	await login(page);

	const title = `E2E Long Chapter ${randomUUID().slice(0, 8)}`;
	await page.locator("#upload").setInputFiles({
		name: "long-chapter.epub",
		mimeType: "application/epub+zip",
		buffer: await buildEpub({
			title,
			creators: ["Test Author"],
			cover: { href: "cover.png", mediaType: "image/png", data: PIXEL },
			chapters: [
				{ href: "c1.xhtml", title: "Autumn", body: "<p>The harvest.</p>" },
				{ href: "c2.xhtml", title: LONG, body: "<p>The frost.</p>" },
				{ href: "c3.xhtml", title: "Spring", body: "<p>The thaw.</p>" },
			],
		}),
	});
	const card = page.getByRole("listitem").filter({ hasText: title });
	await expect(card.getByText("Not started")).toBeVisible({ timeout: 30_000 });
	const { rows } = await db.query<{ id: string }>(
		"select id from editions where title = $1",
		[title],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error(`no edition for ${title}`);

	try {
		await page.goto(`/books/${id}`);
		await page.waitForLoadState("networkidle");
		const position = page.getByTestId("reading-position");
		await position.getByRole("button", { name: "Set position" }).click();
		const dialog = page.getByTestId("reading-position-dialog");
		await dialog.getByRole("button", { name: /^I'm partway through/ }).click();
		await dialog.getByRole("radio", { name: LONG }).check();
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();

		const header = page.locator("header", { has: position });
		const value = page.getByTestId("reading-position-value");
		for (const width of [1280, 768, 360]) {
			await page.setViewportSize({ width, height: 800 });
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(value).toHaveText(LONG);
			await expect(page.getByTestId("reading-progress")).toHaveText("2 of 3");
			const clip = await value.evaluate((el) => ({
				scroll: el.scrollWidth,
				client: el.clientWidth,
				overflow: getComputedStyle(el).textOverflow,
			}));
			expect(clip.scroll, `label clipped at ${width}px`).toBeLessThanOrEqual(
				clip.client,
			);
			expect(clip.overflow).not.toBe("ellipsis");

			const button = position.getByRole("button", { name: "Change position" });
			await expect(button).toBeVisible();
			const box = await button.boundingBox();
			const outer = await header.boundingBox();
			if (!box || !outer) throw new Error("no layout boxes");
			expect(box.x).toBeGreaterThanOrEqual(outer.x);
			expect(box.y).toBeGreaterThanOrEqual(outer.y);
			expect(box.x + box.width).toBeLessThanOrEqual(
				outer.x + outer.width + 0.5,
			);
			expect(box.y + box.height).toBeLessThanOrEqual(
				outer.y + outer.height + 0.5,
			);
			expect(box.x + box.width).toBeLessThanOrEqual(width);
			// Touch-sized.
			expect(box.height).toBeGreaterThanOrEqual(32);

			await header.screenshot({
				path: test.info().outputPath(`book-header-${width}.png`),
			});
			await header.screenshot({
				path: `test-results/book-header-long-label-${width}.png`,
			});
		}
	} finally {
		await db.query("delete from editions where id = $1", [id]);
	}
	expect(pageErrors).toEqual([]);
});
