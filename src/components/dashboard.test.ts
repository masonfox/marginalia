import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingShelfItem } from "#/modules/shelf";
import {
	ContinueReadingHero,
	ContinueSection,
	DashboardEmpty,
	ReadingSection,
} from "./dashboard";

const router = createRouter({
	routeTree: createRootRoute(),
	history: createMemoryHistory(),
});

const render = (element: ReactElement) =>
	renderToStaticMarkup(
		createElement(RouterContextProvider, {
			router,
			// biome-ignore lint/correctness/noChildrenProp: no JSX in .ts tests
			children: element,
		}),
	);

const book = (n: number, extra: Partial<ReadingShelfItem> = {}) => ({
	id: `00000000-0000-4000-8000-00000000000${n}`,
	title: `Book ${n}`,
	authors: [],
	hasCover: false,
	scopeLabel: "Chapter 3",
	...extra,
});

describe("DashboardEmpty", () => {
	it("says there are no books yet and links to the Library", () => {
		const html = render(createElement(DashboardEmpty, { hasBooks: false }));
		expect(html).toContain("No books yet");
		expect(html).toMatch(/<a [^>]*href="\/library"[^>]*>Go to the Library</);
	});

	it("links to the Library when there are books but nothing in progress", () => {
		const html = render(createElement(DashboardEmpty, { hasBooks: true }));
		expect(html).not.toContain("No books yet");
		expect(html).toMatch(/<a [^>]*href="\/library"/);
	});
});

describe("ReadingSection", () => {
	it("is not shown when nothing is being read", () => {
		expect(render(createElement(ReadingSection, { items: [] }))).toBe("");
	});

	it("shows each book's cover, title, authors, and position, linking to it", () => {
		const html = render(
			createElement(ReadingSection, {
				items: [
					book(1, {
						title: "Infinite Jest",
						authors: ["David Foster Wallace"],
						hasCover: true,
					}),
				],
			}),
		);
		expect(html).toContain(`href="/books/${book(1).id}"`);
		expect(html).toContain(`src="/api/covers/${book(1).id}"`);
		expect(html).toContain("Infinite Jest");
		expect(html).toContain("David Foster Wallace");
		expect(html).toContain("Through Chapter 3");
	});

	it("links to the Library filtered to Reading", () => {
		const html = render(createElement(ReadingSection, { items: [book(1)] }));
		expect(html).toContain('href="/library?status=reading"');
	});

	it("keeps every book available in the scrolling phone shelf", () => {
		const html = render(
			createElement(ReadingSection, {
				items: [book(1), book(2), book(3), book(4)],
			}),
		);
		const items = html.match(/<li[^>]*>/g) ?? [];
		expect(items).toHaveLength(4);
		expect(html).not.toContain("max-sm:hidden");
		expect(html).toContain("overflow-x-auto");
	});
});

describe("ContinueSection", () => {
	it("is not shown without conversations", () => {
		expect(render(createElement(ContinueSection, { conversations: [] }))).toBe(
			"",
		);
	});
});

describe("ContinueReadingHero", () => {
	it("links to the real book contents and guide without inventing reading progress", () => {
		const html = render(createElement(ContinueReadingHero, { book: book(1) }));
		expect(html).toContain(`href="/books/${book(1).id}/contents"`);
		expect(html).toContain(`href="/books/${book(1).id}/guide"`);
		expect(html).toContain("Through Chapter 3");
		expect(html).not.toContain("Resume conversation");
		expect(html).not.toContain('role="progressbar"');
	});
});
