import { expect, test } from "@playwright/test";

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
		test.skip(
			(await hero.count()) === 0,
			"Needs an existing book on the reading shelf",
		);
		const title = hero.getByRole("heading", { level: 1 });
		const bookTitle = await title.innerText();
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
		await expect(dialog.getByTestId("composer-book")).toContainText(bookTitle);
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
