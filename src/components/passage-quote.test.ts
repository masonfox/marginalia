import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PassageSnapshot } from "#/lib/passage-ref";
import { PassageQuote } from "./passage-quote";

const router = createRouter({
	routeTree: createRootRoute(),
	history: createMemoryHistory(),
});

const render = (snapshot: PassageSnapshot) =>
	renderToStaticMarkup(
		createElement(RouterContextProvider, {
			router,
			// biome-ignore lint/correctness/noChildrenProp: no JSX in .ts tests
			children: createElement(PassageQuote, { snapshot }),
		}),
	);

/** The router percent-encodes the locator's colons. */
const href = `/p/${encodeURIComponent("3f9a1c07b2de:v1:12.47")}`;

const snapshot: PassageSnapshot = {
	locator: "3f9a1c07b2de:v1:12.47",
	editionId: "ed1",
	bookTitle: "The Communist Manifesto",
	sectionTitle: "Bourgeois and Proletarians",
	text: "The history of all hitherto existing society",
};

describe("PassageQuote", () => {
	it("labels the book text with its book and section and links to the passage", () => {
		const html = render(snapshot);
		expect(html).toContain(
			"Passage from the book · The Communist Manifesto · Bourgeois and Proletarians",
		);
		expect(html).toMatch(/<blockquote[^>]*font-serif[^>]*>The history of all/);
		expect(html).toContain(`href="${href}"`);
	});

	it("links a range with its highlight", () => {
		const html = render({ ...snapshot, range: { start: 4, end: 11 } });
		expect(html).toContain(`href="${href}?hl=4-11"`);
	});

	it("omits a missing section title", () => {
		expect(render({ ...snapshot, sectionTitle: null })).toContain(
			"Passage from the book · The Communist Manifesto</p>",
		);
	});
});
