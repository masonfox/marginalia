import { randomInt, randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { buildEpub } from "../test/epub-builder";

// Needs the instance to run with MARGINALIA_E2E_FAKE_PROGRESS=1, which
// registers the test-only "E2E Fake" progress provider.

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
const FAKE = "e2e-fake";

test.afterAll(async () => {
	await db.end();
});

async function login(page: Page) {
	if (!PASSWORD) {
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		return;
	}
	await page.goto("/login");
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL("/");
	await page.waitForLoadState("networkidle");
}

/** A random valid ISBN-13, so no other book in the library shares it. */
function randomIsbn(): string {
	const first12 = `979${String(randomInt(0, 1e9)).padStart(9, "0")}`;
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
	return first12 + String((10 - (sum % 10)) % 10);
}

// Four chapters of equal length: 60% lands in the third, so a spoiler-safe
// sync rounds down to the second, the last one finished.
const CHAPTERS = [
	"The First Field",
	"The Second Field",
	"The Third Field",
	"The Fourth Field",
];
const paragraphs = (n: number) =>
	Array.from(
		{ length: 20 },
		(_, i) =>
			`<p>Field ${n}, row ${i}: the plough turned the same furrow it turned yesterday.</p>`,
	).join("");

test("Sync now with a list provider sets the rounded-down chapter and shows its source", async ({
	page,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));
	await login(page);
	await page.goto("/library");
	await page.waitForLoadState("networkidle");

	const isbn = randomIsbn();
	const title = `E2E Progress Sync ${randomUUID().slice(0, 8)}`;
	await page.locator("#upload").setInputFiles({
		name: "progress-sync.epub",
		mimeType: "application/epub+zip",
		buffer: await buildEpub({
			title,
			creators: ["Test Author"],
			identifiers: [
				{ value: `urn:uuid:${randomUUID()}`, id: "uid" },
				{ value: `urn:isbn:${isbn}`, id: "isbn" },
			],
			chapters: CHAPTERS.map((name, i) => ({
				href: `c${i + 1}.xhtml`,
				title: name,
				body: `<h1>${name}</h1>${paragraphs(i + 1)}`,
			})),
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
		await page.goto("/settings#reading-sync");
		await page.waitForLoadState("networkidle");
		const fake = page.getByRole("region", { name: "E2E Fake reading sync" });
		await expect(
			fake,
			"the instance must run with MARGINALIA_E2E_FAKE_PROGRESS=1",
		).toBeVisible();
		await fake.getByLabel("ISBN", { exact: true }).fill(isbn);
		await fake.getByLabel("Percent read (optional)").fill("60");
		await fake.getByRole("button", { name: "Save" }).click();
		await expect(fake.getByText("Saved.")).toBeVisible();
		const enabled = fake.getByRole("checkbox", { name: "Sync from E2E Fake" });
		if (!(await enabled.isChecked())) await enabled.click();
		await expect(enabled).toBeChecked();
		await fake.getByRole("button", { name: "Sync now" }).click();
		await expect(fake.getByText("E2E Fake sync started.")).toBeVisible();

		await page.goto(`/books/${id}`);
		const source = page.getByTestId("position-source");
		await expect(async () => {
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(source).toBeVisible({ timeout: 1_000 });
		}).toPass({ timeout: 30_000 });
		await expect(page.getByTestId("reading-position-value")).toHaveText(
			CHAPTERS[1] as string,
		);
		await expect(source).toHaveText(/^Synced from E2E Fake · 60% · \S/);
	} finally {
		await db.query("delete from editions where id = $1", [id]);
		await db.query("delete from progress_providers where kind = $1", [FAKE]);
	}
	expect(pageErrors).toEqual([]);
});
