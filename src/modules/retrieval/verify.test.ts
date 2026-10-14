import { describe, expect, it } from "vitest";
import { findQuote } from "./verify";

describe("findQuote", () => {
	const passage =
		"Gatsby believed in the green light. “So we beat on,” boats against the current—borne back ceaselessly into the past.";

	it("matches straight quotes against curly quotes and reports the original range", () => {
		const range = findQuote(passage, '"so we beat on,"');
		expect(range).not.toBeNull();
		expect(passage.slice(range?.start, range?.end)).toBe("“So we beat on,”");
	});

	it("matches dash variants", () => {
		const range = findQuote(passage, "the current - borne back");
		expect(range).toBeNull();
		const tight = findQuote(passage, "the current-borne back");
		expect(passage.slice(tight?.start, tight?.end)).toBe(
			"the current—borne back",
		);
		expect(findQuote(passage, "the current–borne back")).not.toBeNull();
	});

	it("ignores whitespace and case differences", () => {
		const range = findQuote(passage, "  BELIEVED   in\nthe Green   light ");
		expect(passage.slice(range?.start, range?.end)).toBe(
			"believed in the green light",
		);
	});

	it("rejects a fabricated quote", () => {
		expect(
			findQuote(passage, "So we rowed on, boats against the tide"),
		).toBeNull();
		expect(findQuote(passage, "   ")).toBeNull();
	});

	it("matches across ellipsis and apostrophe variants", () => {
		const text = "It’s over… isn’t it?";
		expect(findQuote(text, "it's over... isn't it?")).toEqual({
			start: 0,
			end: text.length,
		});
	});
});
