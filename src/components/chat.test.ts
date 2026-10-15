import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	SourcesList,
	SourcesScope,
	UserMarkdown,
	type VerifiedCitation,
} from "./chat";

const router = createRouter({
	routeTree: createRootRoute(),
	history: createMemoryHistory(),
});

/** Renders the list inside a message's sources scope, or alone when `scope` is null. */
function render(
	sources: VerifiedCitation[],
	scope: { defaultOpen?: boolean } | null = {},
) {
	const list = createElement(SourcesList, { sources });
	// These tests are plain .ts, so children go through props rather than JSX.
	const children = scope
		? // biome-ignore lint/correctness/noChildrenProp: no JSX in .ts tests
			createElement(SourcesScope, { ...scope, children: list })
		: list;
	return renderToStaticMarkup(
		createElement(RouterContextProvider, { router, children }),
	);
}

const source = (
	n: number,
	bookTitle = "The Great Gatsby",
): VerifiedCitation => ({
	editionId: "ed1",
	locator: `ab:v1:0.${n}`,
	currentLocator: `ab:v1:0.${n}`,
	quote: `quote number ${n}`,
	status: "verified",
	bookTitle,
	sectionTitle: `Chapter ${n}`,
});

const sources = [source(1), source(2), source(3)];

describe("SourcesList", () => {
	it("renders nothing without sources", () => {
		expect(render([])).toBe("");
	});

	it("is collapsed by default to a count and the cited books", () => {
		for (const html of [render(sources), render(sources, null)]) {
			expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
			expect(html).toContain("Sources (3)");
			expect(html).toContain("· The Great Gatsby");
			expect(html).not.toContain("quote number 1");
		}
	});

	it("lists every source in citation order when expanded", () => {
		const html = render(sources, { defaultOpen: true });
		expect(html).toMatch(/<button[^>]*aria-expanded="true"/);
		const quotes = [...html.matchAll(/quote number (\d)/g)].map((m) => m[1]);
		// Each quote appears in the row and its title.
		expect([...new Set(quotes)]).toEqual(["1", "2", "3"]);
		expect(html).toContain('href="/p/ab%3Av1%3A0.2"');
		// One book: rows show only the chapter, not the book again.
		expect(html).toContain("Chapter 2 →");
		expect(html).not.toContain("The Great Gatsby · Chapter 2 →");
	});

	it("names the book on each row when sources span books", () => {
		const html = render([source(1), source(2, "Moby-Dick")], {
			defaultOpen: true,
		});
		expect(html).toContain("· The Great Gatsby, Moby-Dick");
		expect(html).toContain("Moby-Dick · Chapter 2 →");
	});
});

describe("UserMarkdown", () => {
	const html = (text: string) =>
		renderToStaticMarkup(createElement(UserMarkdown, { text }));

	it("renders lists and emphasis as markdown", () => {
		const out = html("Two thoughts:\n\n1. **first**\n2. second");
		expect(out).toContain("<ol");
		expect(out).toContain("<strong>first</strong>");
	});

	it("shows raw HTML as text and never renders it", () => {
		const out = html("<img src=x onerror=alert(1)> and <b>x</b>");
		expect(out).not.toContain("<img");
		expect(out).not.toContain("<b>");
		expect(out).toContain("&lt;img src=x onerror=alert(1)&gt; and &lt;b&gt;x");
		expect(html("<div>\nblock\n</div>")).toContain("&lt;div&gt;");
	});

	it("does not treat citation markers as citations", () => {
		const out = html('See [[cite locator="x:v1:0.0" quote="q"]]');
		expect(out).not.toContain("data-citation-status");
	});
});
