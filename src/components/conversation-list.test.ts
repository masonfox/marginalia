import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoverStack } from "./conversation-list";

const book = (n: number, hasCover = false) => ({
	editionId: `00000000-0000-4000-8000-00000000000${n}`,
	title: `book ${n}`,
	hasCover,
});

const render = (books: ReturnType<typeof book>[]) =>
	renderToStaticMarkup(createElement(CoverStack, { books }));

describe("CoverStack", () => {
	it("shows a cover image for a book that has one", () => {
		const html = render([book(1, true)]);
		expect(html).toContain(`src="/api/covers/${book(1).editionId}"`);
	});

	it("shows the title's initial for a book without a cover", () => {
		const html = render([book(1)]);
		expect(html).not.toContain("<img");
		expect(html).toMatch(/>B<\/span>/);
	});

	it("puts the first book in front of the others", () => {
		const html = render([book(1, true), book(2, true), book(3, true)]);
		const order = [...html.matchAll(/covers\/(\S+?)"/g)].map((m) => m[1]);
		// Painted back to front, so the first book comes last in the markup.
		expect(order).toEqual([book(3), book(2), book(1)].map((b) => b.editionId));
		expect(html).toMatch(/z-index:3[^>]*><img[^>]*covers\/[^"]*1"/);
	});

	it("is hidden from assistive technology", () => {
		expect(render([book(1)])).toMatch(/^<span aria-hidden="true"/);
	});
});
