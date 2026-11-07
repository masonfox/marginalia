// @vitest-environment jsdom
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { coverColors } from "./book-cover";
import { BookHero, BookTabs } from "./book-page";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	// The router restores scroll on navigation; jsdom does not implement it.
	window.scrollTo = () => {};
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

const ID = "00000000-0000-4000-8000-000000000001";

/** A book page route tree like the app's, with `layout` as the book layout. */
async function renderAt(
	url: string,
	layout: () => React.ReactNode,
	hasCover = false,
) {
	const rootRoute = createRootRoute();
	const book = createRoute({
		getParentRoute: () => rootRoute,
		path: "/books/$editionId",
		loader: ({ params }) => ({
			edition: {
				id: params.editionId,
				title: "Moby-Dick",
				authors: ["Herman Melville"],
				coverPath: hasCover ? "cover.jpg" : null,
				status: "processing",
				displayStatus: "processing",
				error: null,
			},
		}),
		component: () => (
			<>
				{layout()}
				<Outlet />
			</>
		),
	});
	const child = (path: string) =>
		createRoute({ getParentRoute: () => book, path, component: () => null });
	const guide = createRoute({
		getParentRoute: () => book,
		path: "guide",
		component: () => <Outlet />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([
			book.addChildren([
				child("/"),
				guide.addChildren([
					createRoute({
						getParentRoute: () => guide,
						path: "chapters",
						component: () => null,
					}),
				]),
				child("contents"),
				child("about"),
			]),
		]),
		history: createMemoryHistory({ initialEntries: [url] }),
	});
	await act(async () => {
		await router.load();
		root.render(<RouterProvider router={router} />);
	});
	return router;
}

const links = () => [
	...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Book"] a'),
];
const link = (name: string) => {
	const el = links().find((a) => a.textContent === name);
	if (!el) throw new Error(`no ${name} tab`);
	return el;
};
const current = () =>
	links()
		.filter((a) => a.getAttribute("aria-current") === "page")
		.map((a) => a.textContent);

/**
 * Presses Enter on the focused element the way a browser does on a link:
 * the keydown, then (unless prevented) a click that follows it.
 */
async function pressEnter() {
	const target = document.activeElement as HTMLElement;
	await act(async () => {
		const down = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		if (target.dispatchEvent(down) && target instanceof HTMLAnchorElement)
			target.click();
	});
}

const tabs = (isReady = true) => <BookTabs editionId={ID} isReady={isReady} />;

describe("BookTabs", () => {
	it.each([
		[`/books/${ID}`, "Discuss"],
		[`/books/${ID}/guide/chapters`, "Guide"],
		[`/books/${ID}/contents`, "Contents"],
		[`/books/${ID}/about`, "About"],
	])("marks only the current tab at %s with aria-current", async (url, tab) => {
		await renderAt(url, () => tabs());
		expect(current()).toEqual([tab]);
	});

	it("offers no Guide until the book is ready", async () => {
		await renderAt(`/books/${ID}`, () => tabs(false));
		expect(links().map((a) => a.textContent)).toEqual([
			"Discuss",
			"Contents",
			"About",
		]);
	});

	it("is a row of links reached with Tab, in reading order", async () => {
		await renderAt(`/books/${ID}`, () => tabs());
		expect(links().map((a) => a.textContent)).toEqual([
			"Discuss",
			"Guide",
			"Contents",
			"About",
		]);
		for (const a of links()) {
			expect(a.getAttribute("href")).toMatch(new RegExp(`^/books/${ID}`));
			// Native links are in the tab order unless a tabindex removes them.
			expect(a.tabIndex).toBe(0);
			expect(a.getAttribute("tabindex")).toBeNull();
		}
	});

	it("follows a tab with Enter, moving aria-current and keeping focus on it", async () => {
		const router = await renderAt(`/books/${ID}`, () => tabs());
		act(() => link("Contents").focus());
		await pressEnter();
		expect(router.state.location.pathname).toBe(`/books/${ID}/contents`);
		expect(current()).toEqual(["Contents"]);
		expect(document.activeElement).toBe(link("Contents"));

		act(() => link("Guide").focus());
		await pressEnter();
		expect(router.state.location.pathname).toBe(`/books/${ID}/guide`);
		expect(current()).toEqual(["Guide"]);
		expect(document.activeElement).toBe(link("Guide"));
	});
});

describe("BookHero", () => {
	it("samples a new cover when navigating between books without remounting the hero", async () => {
		vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
			true,
		);
		vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
			100,
		);
		const getImageData = vi
			.fn()
			.mockReturnValueOnce({ data: new Uint8ClampedArray([200, 20, 10, 255]) })
			.mockReturnValue({ data: new Uint8ClampedArray([10, 30, 200, 255]) });
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
			getImageData,
		} as unknown as CanvasRenderingContext2D);
		const router = await renderAt(
			`/books/${ID}`,
			() => <BookHero variant="full" />,
			true,
		);
		const backdrop = () =>
			document.querySelector("header > [aria-hidden]")?.getAttribute("style");
		expect(backdrop()).toContain("rgb(200, 20, 10)");
		await act(async () => {
			await router.navigate({
				to: "/books/$editionId",
				params: { editionId: "00000000-0000-4000-8000-000000000002" },
			});
		});
		expect(backdrop()).toContain("rgb(10, 30, 200)");
	});
	it.each([
		"full",
		"compact",
	] as const)("titles the %s hero with the book's title and keeps the tabs inside it", async (variant) => {
		await renderAt(`/books/${ID}`, () => <BookHero variant={variant} />);
		const hero = document.querySelector("header");
		expect(hero?.getAttribute("data-variant")).toBe(variant);
		const title = hero?.querySelector("h1");
		expect(title?.textContent).toBe("Moby-Dick");
		expect(hero?.querySelector('nav[aria-label="Book"]')).not.toBeNull();
		expect(hero?.querySelector("[data-testid=import-status]")).not.toBeNull();
	});

	it("shows a typeset cover named by the title, and tints the backdrop with its color", async () => {
		await renderAt(`/books/${ID}`, () => <BookHero variant="full" />);
		const cover = document.querySelector('[role="img"]');
		expect(cover?.getAttribute("aria-label")).toBe("Moby-Dick");
		const backdrop = document.querySelector<HTMLElement>(
			"header > [aria-hidden]",
		);
		// jsdom drops gradients it cannot parse, so read the authored style.
		expect(backdrop?.getAttribute("style") ?? "").toContain(
			coverColors("Moby-Dick").background,
		);
	});

	it("shows initials on the compact hero's small typeset cover", async () => {
		await renderAt(`/books/${ID}`, () => <BookHero variant="compact" />);
		expect(document.querySelector('[role="img"]')?.textContent).toBe("MD");
	});
});
