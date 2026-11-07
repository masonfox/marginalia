// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookCover, COVER_PALETTE, coverColors, surname } from "./book-cover";

const render = (props: Parameters<typeof BookCover>[0]) => {
	const doc = new DOMParser().parseFromString(
		renderToStaticMarkup(<BookCover {...props} />),
		"text/html",
	);
	return doc.body.firstElementChild as HTMLElement;
};

/** jsdom normalizes inline colors to rgb(); compare against the palette the same way. */
const rgb = (hex: string) => {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe("typeset cover", () => {
	it("gives the same title the same palette color every time", () => {
		const a = render({ id: "1", title: "Moby-Dick", hasCover: false });
		const b = render({ id: "2", title: "Moby-Dick", hasCover: false });
		expect(a.style.background).not.toBe("");
		expect(a.style.background).toBe(b.style.background);
		expect(a.style.color).toBe(b.style.color);
		const expected = coverColors("Moby-Dick");
		expect(COVER_PALETTE).toContain(expected);
		expect(a.style.background).toBe(rgb(expected.background));
		expect(a.style.color).toBe(rgb(expected.color));
	});

	it("spreads different titles across the palette", () => {
		const titles = [
			"Moby-Dick",
			"Middlemarch",
			"Infinite Jest",
			"Piranesi",
			"The Communist Manifesto",
			"Tress of the Emerald Sea",
			"Bleak House",
			"Persuasion",
		];
		const used = new Set(titles.map((t) => coverColors(t).background));
		expect(used.size).toBeGreaterThan(3);
	});

	it("is an image named by the title, with the author's surname", () => {
		const el = render({
			id: "1",
			title: "Middlemarch",
			author: "George Eliot",
			hasCover: false,
		});
		expect(el.getAttribute("role")).toBe("img");
		expect(el.getAttribute("aria-label")).toBe("Middlemarch");
		expect(el.textContent).toBe("MiddlemarchEliot");
	});

	it("takes the surname from either name order", () => {
		expect(surname("Herman Melville")).toBe("Melville");
		expect(surname("Melville, Herman")).toBe("Melville");
		expect(surname("Plato")).toBe("Plato");
	});
});

describe("real cover image", () => {
	it("renders the stored image with no typeset color or text", () => {
		const el = render({
			id: "abc",
			title: "Moby-Dick",
			author: "Herman Melville",
			hasCover: true,
		});
		expect(el.tagName).toBe("IMG");
		expect(el.getAttribute("src")).toBe("/api/covers/abc");
		expect(el.getAttribute("alt")).toBe("");
		expect(el.getAttribute("style")).toBeNull();
		expect(el.textContent).toBe("");
		expect(el.className).toContain("shadow-cover");
	});
});
