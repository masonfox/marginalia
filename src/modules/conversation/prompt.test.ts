import { describe, expect, it } from "vitest";
import { buildSystemPrompt, PROMPT_VERSION } from "./prompt";

const opts = { maxSteps: 8 };

describe("buildSystemPrompt", () => {
	const prompt = buildSystemPrompt(
		[
			{
				ordinal: 0,
				title: "The Great Gatsby",
				authors: ["F. Scott Fitzgerald"],
				scopeLabel: null,
			},
		],
		opts,
	);

	it("names the book with its handle and author", () => {
		expect(prompt).toContain('b1: "The Great Gatsby" by F. Scott Fitzgerald');
	});

	it("lists every book of a multi-book conversation", () => {
		const multi = buildSystemPrompt(
			[
				{ ordinal: 0, title: "One", authors: [], scopeLabel: null },
				{ ordinal: 1, title: "Two", authors: [], scopeLabel: null },
			],
			opts,
		);
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

	it("states the tool budget and what happens on the last turn", () => {
		expect(prompt).toMatch(/You have 8 turns per reply/);
		expect(buildSystemPrompt([], { maxSteps: 3 })).toMatch(
			/You have 3 turns per reply/,
		);
		expect(prompt).toMatch(/Read only what you need/);
		expect(prompt).toMatch(/Use targeted searches to find what matters/);
		expect(prompt).toMatch(/To read a whole scene or chapter, use readSection/);
		expect(prompt).toMatch(/Use readPassage to check a single passage/);
		expect(prompt).toMatch(/final turn tools are unavailable/);
		expect(prompt).toMatch(/say what you did not get to read/);
	});

	it("has a version", () => {
		expect(PROMPT_VERSION).toMatch(/^\d+$/);
	});
});

describe("scope in the system prompt", () => {
	const gatsby = {
		ordinal: 0,
		title: "The Great Gatsby",
		authors: ["F. Scott Fitzgerald"],
	};
	const whole = buildSystemPrompt([{ ...gatsby, scopeLabel: null }], opts);
	const bounded = buildSystemPrompt(
		[{ ...gatsby, scopeLabel: "Chapter 5" }],
		opts,
	);

	it("states how far the reader has read", () => {
		expect(bounded).toContain(
			'b1: "The Great Gatsby" by F. Scott Fitzgerald — the reader has read through "Chapter 5"',
		);
		expect(whole).not.toContain("read through");
	});

	it("forbids later events, including from outside knowledge, when bounded", () => {
		expect(bounded).toMatch(/hard rule/);
		expect(bounded).toMatch(/Do not reveal, hint at, or speculate/);
		expect(bounded).toMatch(/what you know about the book from outside/);
		expect(bounded).toMatch(/say plainly that you can only discuss the book/);
		expect(bounded).not.toMatch(/courtesy, not a guarantee/);
	});

	it("keeps the courtesy for whole-book conversations", () => {
		expect(whole).toMatch(/Do not volunteer events/);
		expect(whole).toMatch(/courtesy, not a guarantee/);
		expect(whole).not.toMatch(/hard rule/);
	});

	it("keeps the courtesy for whole-book books in a mixed conversation", () => {
		const mixed = buildSystemPrompt(
			[
				{ ...gatsby, scopeLabel: "Chapter 5" },
				{ ordinal: 1, title: "Other", authors: [], scopeLabel: null },
			],
			opts,
		);
		expect(mixed).toMatch(/The reader has not finished b1;/);
		expect(mixed).toMatch(
			/For b2, which the reader has read in full: Do not volunteer/,
		);
	});

	it("is byte-identical for the same books and scopes", () => {
		expect(
			buildSystemPrompt([{ ...gatsby, scopeLabel: "Chapter 5" }], opts),
		).toBe(bounded);
		expect(buildSystemPrompt([{ ...gatsby, scopeLabel: null }], opts)).toBe(
			whole,
		);
	});

	it("changed the prompt version", () => {
		expect(PROMPT_VERSION).toBe("4");
	});
});
