// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PassageText, segmentPassage } from "./passage-text";

const text = "Brawne Lamia met Kassad at the Shrike.";
const gloss = (start: number, end: number) => ({ start, end, ref: `${start}` });

/** Blocks as [highlighted, [text, glossed]...] for comparison. */
const shape = (blocks: ReturnType<typeof segmentPassage>) =>
	blocks.map((b) => [
		b.highlighted,
		b.segments.map((s) => [s.text, s.gloss !== null]),
	]);

const joined = (blocks: ReturnType<typeof segmentPassage>) =>
	blocks.flatMap((b) => b.segments.map((s) => s.text)).join("");

describe("segmentPassage", () => {
	it("marks glosses and keeps the text intact", () => {
		const blocks = segmentPassage(text, null, [gloss(0, 12), gloss(17, 23)]);
		expect(shape(blocks)).toEqual([
			[
				false,
				[
					["Brawne Lamia", true],
					[" met ", false],
					["Kassad", true],
					[" at the Shrike.", false],
				],
			],
		]);
		expect(joined(blocks)).toBe(text);
	});

	it("nests glosses inside the highlight and drops ones crossing its edge", () => {
		// Highlight "Lamia met Kassad"; Brawne Lamia crosses its start.
		const blocks = segmentPassage(text, { start: 7, end: 23 }, [
			gloss(0, 12),
			gloss(17, 23),
		]);
		expect(shape(blocks)).toEqual([
			[false, [["Brawne ", false]]],
			[
				true,
				[
					["Lamia met ", false],
					["Kassad", true],
				],
			],
			[false, [[" at the Shrike.", false]]],
		]);
		expect(joined(blocks)).toBe(text);
	});

	it("ignores out-of-range highlights and overlapping glosses", () => {
		const blocks = segmentPassage(text, { start: 0, end: 999 }, [
			gloss(0, 12),
			gloss(7, 12),
		]);
		expect(shape(blocks)).toEqual([
			[
				false,
				[
					["Brawne Lamia", true],
					[" met Kassad at the Shrike.", false],
				],
			],
		]);
	});
});

describe("PassageText", () => {
	it("renders glosses with the renderer, and its text equals the passage", () => {
		const html = renderToStaticMarkup(
			createElement(PassageText<ReturnType<typeof gloss>>, {
				locator: "x",
				text,
				range: { start: 13, end: 16 },
				glosses: [gloss(17, 23)],
				renderGloss: (g, t) =>
					createElement("mark", { "data-gloss": g.ref }, t),
			}),
		);
		expect(html).toBe(
			'<span data-passage-text="x">Brawne Lamia <mark data-testid="quote-highlight" class="rounded-sm bg-primary/25 px-0.5 text-foreground">met</mark> <mark data-gloss="17">Kassad</mark> at the Shrike.</span>',
		);
		const host = document.createElement("div");
		host.innerHTML = html;
		expect(host.textContent).toBe(text);
	});

	it("renders no glosses without a renderer", () => {
		const html = renderToStaticMarkup(
			createElement(PassageText, {
				locator: "x",
				text,
				range: null,
				glosses: [gloss(0, 6)],
			}),
		);
		expect(html).toBe(`<span data-passage-text="x">${text}</span>`);
	});
});
