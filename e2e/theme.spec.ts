import { expect, type Page, test } from "@playwright/test";

// Theme and fonts are set up by the root document, so these checks work on
// any page, including the login page when the instance requires a password.

const THEME_KEY = "marginalia:theme";
const BACKGROUNDS = {
	light: "rgb(250, 248, 244)",
	sepia: "rgb(242, 232, 214)",
	dark: "rgb(13, 10, 8)",
} as const;

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
	pageErrors = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
	expect(pageErrors).toEqual([]);
});

/**
 * Records every data-theme value <html> takes and the page background in the
 * first animation frame, from before any of the page's own scripts run.
 */
async function recordThemeFrames(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as {
			__themes: (string | null)[];
			__firstFrame: { theme: string | null; background: string } | null;
		};
		w.__themes = [];
		w.__firstFrame = null;
		// <html> may not exist yet, so watch the whole document.
		new MutationObserver((records) => {
			for (const r of records) {
				if (r.target === document.documentElement)
					w.__themes.push(document.documentElement.getAttribute("data-theme"));
			}
		}).observe(document, {
			subtree: true,
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		requestAnimationFrame(() => {
			w.__firstFrame = {
				theme: document.documentElement.getAttribute("data-theme"),
				background: getComputedStyle(document.body).backgroundColor,
			};
		});
	});
}

const themeFrames = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as {
			__themes: (string | null)[];
			__firstFrame: { theme: string | null; background: string } | null;
		};
		return { themes: w.__themes, firstFrame: w.__firstFrame };
	});

const htmlTheme = (page: Page) => page.locator("html");

test("fonts are served by the instance itself", async ({ page, baseURL }) => {
	const origin = new URL(baseURL ?? "http://localhost:3000").origin;
	const fontRequests: string[] = [];
	page.on("request", (request) => {
		const url = request.url();
		if (
			request.resourceType() === "font" ||
			/\.(woff2?|ttf|otf)(\?|$)/.test(url) ||
			/fonts\.(googleapis|gstatic)\.com/.test(url)
		)
			fontRequests.push(url);
	});
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	await page.evaluate(() => document.fonts.ready);

	expect(fontRequests.length).toBeGreaterThan(0);
	for (const url of fontRequests) expect(new URL(url).origin).toBe(origin);

	// The interface face is loaded and in use.
	expect(
		await page.evaluate(() => document.fonts.check('16px "Instrument Sans"')),
	).toBe(true);
	await expect(page.locator("body")).toHaveCSS(
		"font-family",
		/^"Instrument Sans"/,
	);
});

test("a stored sepia theme shows from the first frame, with no light or dark frame", async ({
	page,
}) => {
	// Sepia must win over the system preference.
	await page.emulateMedia({ colorScheme: "dark" });
	await page.addInitScript((key) => {
		localStorage.setItem(key, "sepia");
	}, THEME_KEY);
	await recordThemeFrames(page);
	await page.goto("/");
	await page.waitForLoadState("networkidle");

	const { themes, firstFrame } = await themeFrames(page);
	expect(themes.length).toBeGreaterThan(0);
	expect(new Set(themes)).toEqual(new Set(["sepia"]));
	expect(firstFrame).toEqual({ theme: "sepia", background: BACKGROUNDS.sepia });

	await expect(htmlTheme(page)).toHaveAttribute("data-theme", "sepia");
	await expect(htmlTheme(page)).toHaveCSS("color-scheme", "light");
	await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
		"content",
		"#f2e8d6",
	);

	// Still sepia after a reload and on another page.
	await page.reload();
	await expect(htmlTheme(page)).toHaveAttribute("data-theme", "sepia");
	await page.goto("/settings");
	await expect(htmlTheme(page)).toHaveAttribute("data-theme", "sepia");
	const after = await themeFrames(page);
	expect(new Set(after.themes)).toEqual(new Set(["sepia"]));
});

test("with no stored choice the theme follows the system, live", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await recordThemeFrames(page);
	await page.goto("/");
	await page.waitForLoadState("networkidle");

	expect(await themeFrames(page)).toEqual({
		themes: ["dark"],
		firstFrame: { theme: "dark", background: BACKGROUNDS.dark },
	});
	await expect(htmlTheme(page)).toHaveCSS("color-scheme", "dark");

	// The OS switches to light: the page follows without a reload.
	await page.emulateMedia({ colorScheme: "light" });
	await expect(htmlTheme(page)).toHaveAttribute("data-theme", "light");
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		BACKGROUNDS.light,
	);
	await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
		"content",
		"#faf8f4",
	);

	await page.emulateMedia({ colorScheme: "dark" });
	await expect(htmlTheme(page)).toHaveAttribute("data-theme", "dark");
});

test("a stored choice of system follows the system too", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.addInitScript((key) => {
		localStorage.setItem(key, "system");
	}, THEME_KEY);
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	await expect(htmlTheme(page)).toHaveAttribute("data-theme", "light");
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(htmlTheme(page)).toHaveAttribute("data-theme", "dark");
});

test("saved system Sepia paints first, persists, and follows live OS changes", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.addInitScript(() => {
		if (!sessionStorage.getItem("theme-seeded")) {
			localStorage.setItem("marginalia:theme", "system");
			localStorage.setItem("marginalia:system-light-theme", "sepia");
			sessionStorage.setItem("theme-seeded", "true");
		}
	});
	await recordThemeFrames(page);
	for (const path of ["/", "/settings"]) {
		await page.goto(path);
		await page.waitForLoadState("networkidle");
		const frames = await themeFrames(page);
		expect(new Set(frames.themes)).toEqual(new Set(["sepia"]));
		expect(frames.firstFrame).toEqual({
			theme: "sepia",
			background: BACKGROUNDS.sepia,
		});
	}
	await page.reload();
	await page.waitForLoadState("networkidle");
	expect((await themeFrames(page)).firstFrame).toEqual({
		theme: "sepia",
		background: BACKGROUNDS.sepia,
	});
	await expect(htmlTheme(page)).toHaveCSS("color-scheme", "light");
	await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
		"content",
		"#f2e8d6",
	);
	await page.emulateMedia({ colorScheme: "dark" });
	await expect(htmlTheme(page)).toHaveAttribute("data-theme", "dark");
	await expect(htmlTheme(page)).toHaveCSS("color-scheme", "dark");
	await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
		"content",
		"#0d0a08",
	);
	await page.emulateMedia({ colorScheme: "light" });
	await expect(htmlTheme(page)).toHaveAttribute("data-theme", "sepia");
	await expect(page.locator("body")).toHaveCSS(
		"background-color",
		BACKGROUNDS.sepia,
	);
	expect(
		await page.evaluate(() => localStorage.getItem("marginalia:theme")),
	).toBe("system");
});
