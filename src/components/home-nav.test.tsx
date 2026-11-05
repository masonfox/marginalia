// @vitest-environment jsdom
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
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
import { HeaderMenu, HomeNav } from "./home-nav";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	// Radix's popper measures its anchor; jsdom has no ResizeObserver.
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
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
	document.body.replaceChildren();
});

/** Renders the header's navigation and menu on a router opened at `url`. */
async function renderAt(url: string, { authEnabled = false } = {}) {
	const rootRoute = createRootRoute({
		component: () => (
			<header>
				<HomeNav />
				<HeaderMenu authEnabled={authEnabled} />
			</header>
		),
	});
	const page = (path: string) =>
		createRoute({ getParentRoute: () => rootRoute, path });
	const router = createRouter({
		routeTree: rootRoute.addChildren([
			page("/"),
			page("/library"),
			page("/conversations"),
			page("/settings"),
			page("/books/$editionId"),
		]),
		history: createMemoryHistory({ initialEntries: [url] }),
	});
	await act(async () => {
		await router.load();
		root.render(<RouterProvider router={router} />);
	});
	return router;
}

const nav = () => {
	const el = document.querySelector('nav[aria-label="Main"]');
	if (!el) throw new Error("no navigation");
	return el;
};
const trigger = () => {
	const el = document.querySelector<HTMLButtonElement>(
		'button[aria-label="Menu"]',
	);
	if (!el) throw new Error("no menu button");
	return el;
};
const items = () => [
	...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
];
const names = (els: Iterable<Element>) =>
	[...els].map((el) => el.textContent?.trim());
const current = (els: Iterable<Element>) =>
	names([...els].filter((el) => el.getAttribute("aria-current") === "page"));

const keydown = async (target: Element, key: string) => {
	await act(async () => {
		target.dispatchEvent(
			new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
		);
	});
};

const openMenu = async () => {
	trigger().focus();
	await keydown(trigger(), "Enter");
};

describe("HomeNav", () => {
	it.each([
		["/", "Dashboard"],
		["/library", "Library"],
		["/library?q=woolf&status=reading", "Library"],
		["/conversations", "Conversations"],
	])("on %s marks %s as the current page", async (url, entry) => {
		await renderAt(url);
		const links = nav().querySelectorAll("a");
		expect(names(links)).toEqual(["Dashboard", "Library", "Conversations"]);
		expect(current(links)).toEqual([entry]);
	});

	it("marks no entry on a book's page", async () => {
		await renderAt("/books/00000000-0000-4000-8000-000000000001");
		expect(current(nav().querySelectorAll("a"))).toEqual([]);
	});

	it("links each entry without a search", async () => {
		await renderAt("/library?q=woolf");
		expect(
			[...nav().querySelectorAll("a")].map((a) => a.getAttribute("href")),
		).toEqual(["/", "/library", "/conversations"]);
	});
});

describe("HeaderMenu", () => {
	it("is a closed menu button named Menu", async () => {
		await renderAt("/");
		expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it("lists the navigation entries, a separator, and Settings, with the inline navigation's entries", async () => {
		await renderAt("/");
		await openMenu();
		expect(trigger().getAttribute("aria-expanded")).toBe("true");
		const menu = document.querySelector('[role="menu"]');
		expect(names(items())).toEqual([
			...names(nav().querySelectorAll("a")),
			"Settings",
		]);
		expect(
			[...(menu?.children ?? [])].map((el) => el.getAttribute("role")),
		).toEqual(["menuitem", "menuitem", "menuitem", "separator", "menuitem"]);
	});

	it.each([
		["/conversations", ["Conversations"]],
		["/library?status=reading", ["Library"]],
		["/books/00000000-0000-4000-8000-000000000001", []],
	])("on %s marks %j in the menu", async (url, marked) => {
		await renderAt(url);
		await openMenu();
		expect(current(items())).toEqual(marked);
	});

	it("offers Log out only when a password is set, and submits the logout form", async () => {
		await renderAt("/");
		await openMenu();
		expect(names(items())).not.toContain("Log out");
		act(() => root.unmount());
		root = createRoot(container);

		await renderAt("/", { authEnabled: true });
		const form = document.querySelector<HTMLFormElement>(
			'form[action="/logout"]',
		);
		expect(form?.method).toBe("post");
		const submit = vi.fn();
		form?.addEventListener("submit", (e) => {
			e.preventDefault();
			submit();
		});
		await openMenu();
		expect(names(items()).at(-1)).toBe("Log out");
		const logOut = items().at(-1);
		if (!logOut) throw new Error("no Log out");
		await keydown(logOut, "Enter");
		expect(submit).toHaveBeenCalledOnce();
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it("navigates and closes when an entry is chosen", async () => {
		const router = await renderAt("/");
		await openMenu();
		const library = items().find((el) => el.textContent === "Library");
		await act(async () => {
			library?.click();
		});
		await vi.waitFor(() =>
			expect(router.state.location.pathname).toBe("/library"),
		);
		expect(document.querySelector('[role="menu"]')).toBeNull();
	});

	it("closes on Escape and returns focus to the menu button", async () => {
		await renderAt("/");
		await openMenu();
		const menu = document.querySelector('[role="menu"]');
		if (!menu) throw new Error("menu not open");
		await keydown(menu, "Escape");
		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(trigger().getAttribute("aria-expanded")).toBe("false");
		expect(document.activeElement).toBe(trigger());
	});
});
