// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { PassageText } from "#/components/passage-text";
import { selectionToPassageRef } from "./passage-selection";

const A = "aaaaaaaaaaaa:v1:0.0";
const B = "aaaaaaaaaaaa:v1:0.1";
const textA =
	"The history of all hitherto existing society\nis the history of class struggles.";
const textB = "Freeman and slave, patrician and plebeian.";

/** The passage view's markup: text in `data-passage-text`, notes beside it. */
function mount(highlight: { start: number; end: number } | null = null) {
	const passage = (locator: string, text: string, range = highlight) =>
		`<div data-locator="${locator}" class="whitespace-pre-line">${renderToStaticMarkup(
			createElement(PassageText, { locator, text, range }),
		)}<details><summary>Note 1</summary><p>A note.</p></details></div>`;
	document.body.innerHTML = `<nav>Breadcrumb</nav><article>${passage(A, textA)}${passage(B, textB, null)}</article>`;
}

const textNodes = (locator: string) => {
	const host = document.querySelector(`[data-passage-text="${locator}"]`);
	const walker = document.createTreeWalker(host as Node, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	while (walker.nextNode()) nodes.push(walker.currentNode as Text);
	return nodes;
};

function select(
	start: [Node, number],
	end: [Node, number],
): ReturnType<typeof selectionToPassageRef> {
	const range = document.createRange();
	range.setStart(...start);
	range.setEnd(...end);
	const selection = window.getSelection() as Selection;
	selection.removeAllRanges();
	selection.addRange(range);
	return selectionToPassageRef(selection);
}

beforeEach(() => mount());

describe("selectionToPassageRef", () => {
	it("measures offsets that match the passage text", () => {
		const [node] = textNodes(A);
		const ref = select([node as Text, 4], [node as Text, 11]);
		expect(ref).toEqual({ locator: A, range: { start: 4, end: 11 } });
		expect(textA.slice(4, 11)).toBe("history");
	});

	it("keeps offsets across line breaks", () => {
		const [node] = textNodes(A);
		const at = textA.indexOf("is the");
		const ref = select([node as Text, at - 8], [node as Text, at + 6]);
		expect(textA.slice(ref?.range?.start, ref?.range?.end)).toBe(
			"society\nis the",
		);
	});

	it("matches the text with an existing highlight splitting it", () => {
		mount({ start: 8, end: 30 });
		const nodes = textNodes(A);
		expect(nodes).toHaveLength(3);
		// From inside the text before the mark to inside the text after it.
		const ref = select([nodes[0] as Text, 4], [nodes[2] as Text, 8]);
		expect(ref?.range).toEqual({ start: 4, end: 38 });
		expect(textA.slice(4, 38)).toBe(
			`${nodes[0]?.data.slice(4)}${nodes[1]?.data}${nodes[2]?.data.slice(0, 8)}`,
		);
		// Entirely inside the mark.
		const inner = select([nodes[1] as Text, 2], [nodes[1] as Text, 9]);
		expect(inner?.range).toEqual({ start: 10, end: 17 });
		expect(textA.slice(10, 17)).toBe(nodes[1]?.data.slice(2, 9));
	});

	it("trims surrounding whitespace", () => {
		const [node] = textNodes(A);
		const ref = select([node as Text, 3], [node as Text, 12]);
		expect(ref?.range).toEqual({ start: 4, end: 11 });
		expect(select([node as Text, 3], [node as Text, 4])).toBeNull();
	});

	it("returns null across passages, into notes, or outside the text", () => {
		const [a] = textNodes(A);
		const [b] = textNodes(B);
		expect(select([a as Text, 4], [b as Text, 4])).toBeNull();
		const note = document.querySelector("details p")?.firstChild as Text;
		expect(select([a as Text, 4], [note, 3])).toBeNull();
		const nav = document.querySelector("nav")?.firstChild as Text;
		expect(select([nav, 0], [a as Text, 4])).toBeNull();
		expect(select([a as Text, 4], [a as Text, 4])).toBeNull();
	});
});
