import { describe, expect, it } from "vitest";
import { buildSystemPrompt, PROMPT_VERSION } from "./prompt";

describe("buildSystemPrompt", () => {
	const prompt = buildSystemPrompt([
		{ ordinal: 0, title: "The Great Gatsby", authors: ["F. Scott Fitzgerald"] },
	]);

	it("names the book with its handle and author", () => {
		expect(prompt).toContain('b1: "The Great Gatsby" by F. Scott Fitzgerald');
	});

	it("lists every book of a multi-book conversation", () => {
		const multi = buildSystemPrompt([
			{ ordinal: 0, title: "One", authors: [] },
			{ ordinal: 1, title: "Two", authors: [] },
		]);
		expect(multi).toContain('b1: "One"');
		expect(multi).toContain('b2: "Two"');
	});

	it.each([
		["retrieve before claiming", /Retrieve before you claim/],
		["rests on retrieved passages", /not on memory of the book/],
		["admits missing support", /could not find this in the text/],
		["evidence label", /\*\*Evidence\*\*/],
		["interpretation label", /\*\*Interpretation\*\*/],
		["alternative readings", /alternative readings/],
		[
			"citation marker format",
			/\[\[cite locator="<locator>" quote="<exact words>"\]\]/,
		],
		["verbatim quotes", /verbatim/],
		["no invented citations", /Never invent a locator or a quote/],
		["own reading", /own reading instead of mirroring/],
		["disagree on weak evidence", /disagree and explain why/],
		["complicating passages", /complicate the reader's theory/],
		["pointed follow-up", /pointed follow-up question/],
		["no flattery", /No praise, flattery/],
		["soft spoiler rule", /Do not volunteer events/],
	])("instructs: %s", (_name, pattern) => {
		expect(prompt).toMatch(pattern);
	});

	it("has a version", () => {
		expect(PROMPT_VERSION).toMatch(/^\d+$/);
	});
});
