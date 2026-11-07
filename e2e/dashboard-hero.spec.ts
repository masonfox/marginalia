import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";

const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });

test.describe("dashboard hero", () => {
	// One seeded book being read, its position set further in the future than
	// any other fixture so it is the continue-reading hero. Removed afterwards.
	const runId = randomUUID().slice(0, 8);
	const seededTitle = `E2E Hero ${runId}`;
	const shelfDir = `e2e-dashboard-hero/${runId}/`;

	test.beforeAll(async () => {
		const { rows: sources } = await db.query<{ id: number }>(
			"select id from library_sources where kind = 'upload' limit 1",
		);
		const source = sources[0];
		if (!source) throw new Error("no upload library source");
		const { rows } = await db.query<{ id: string; sha256: string }>(
			`insert into editions (sha256, short_id, title, authors, status)
			 select sha, substr(sha, 1, 16), $1, '["Hero Author"]'::jsonb, 'ready'
			 from (select md5($1) || md5($1 || ' hero') as sha) s
			 returning id, sha256`,
			[seededTitle],
		);
		const edition = rows[0];
		if (!edition) throw new Error("seeded edition was not inserted");
		await db.query(
			`insert into library_files (source_id, rel_path, size, mtime, sha256)
			 values ($1, $2 || $3 || '.epub', 1, now(), $3)`,
			[source.id, shelfDir, edition.sha256],
		);
		await db.query(
			`insert into reading_positions (edition_id, max_position, scope_label, updated_at)
			 values ($1, 1, 'Chapter 1', now() + interval '2 days')`,
			[edition.id],
		);
	});

	test.afterAll(async () => {
		// reading_positions rows cascade with the edition.
		await db.query("delete from editions where title = $1", [seededTitle]);
		await db.query("delete from library_files where rel_path like $1 || '%'", [
			shelfDir,
		]);
		await db.end();
	});

	for (const width of [360, 390, 768, 1440]) {
		test(`dashboard hero stays compact and starts a new book conversation at ${width}px`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto("/");
			if (new URL(page.url()).pathname === "/login") {
				await page
					.getByLabel("Password", { exact: true })
					.fill(process.env.E2E_PASSWORD ?? "");
				await page.getByRole("button", { name: "Log in", exact: true }).click();
			}
			await page.waitForLoadState("networkidle");
			const hero = page.locator(
				'section[aria-labelledby="continue-reading-title"]',
			);
			await expect(hero).toBeVisible();
			const title = hero.getByRole("heading", { level: 1 });
			await expect(title).toHaveText(seededTitle);
			const cover = await hero.getByRole("link").first().boundingBox();
			const heading = await title.boundingBox();
			expect(cover).not.toBeNull();
			expect(heading).not.toBeNull();
			if (!cover || !heading)
				throw new Error("Hero cover or title has no layout");
			expect(cover.width).toBeLessThanOrEqual(196);
			expect(cover.x + cover.width).toBeLessThanOrEqual(heading.x);
			expect(heading.y).toBeLessThan(cover.y + cover.height);
			expect(heading.y + heading.height).toBeGreaterThan(cover.y);
			const preview = page.getByTestId("conversation-preview").first();
			if (await preview.count())
				expect(
					await preview.evaluate(
						(element) =>
							element.clientHeight <=
							Number.parseFloat(getComputedStyle(element).lineHeight) * 2 + 1,
					),
				).toBe(true);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth - innerWidth,
				),
			).toBeLessThanOrEqual(0);
			const start = hero.getByRole("button", {
				name: "New conversation",
				exact: true,
			});
			await expect(start).toBeVisible();
			await expect(
				hero.getByRole("link", { name: "Resume conversation" }),
			).toHaveCount(0);
			await start.click();
			const dialog = page.getByTestId("header-new-conversation-dialog");
			await expect(dialog).toBeVisible();
			await expect(dialog.getByTestId("composer-book")).toHaveCount(1);
			await expect(dialog.getByTestId("composer-book")).toContainText(
				seededTitle,
			);
			await expect(
				dialog.getByLabel("Your question", { exact: true }),
			).toHaveValue("");
			await expect(
				dialog.getByRole("button", { name: "Start conversation", exact: true }),
			).toBeVisible();
			await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect(start).toBeFocused();
		});
	}
});
