import { describe, expect, it } from "vitest";
import { previewText } from "./preview-text";

describe("previewText", () => {
	it("removes emphasis", () => {
		expect(
			previewText("**Hal** is reading the *dictionary* because __he__ _must_"),
		).toBe("Hal is reading the dictionary because he must");
		expect(previewText("~~struck~~ and ***both***")).toBe("struck and both");
	});

	it("keeps underscores and asterisks that are not emphasis", () => {
		expect(previewText("snake_case_name and 2 * 3 * 4")).toBe(
			"snake_case_name and 2 * 3 * 4",
		);
		expect(previewText(String.raw`an \*escaped\* star`)).toBe(
			"an *escaped* star",
		);
	});

	it("keeps link text and drops link targets", () => {
		expect(
			previewText(
				"See [the essay](https://example.com/a?b=c) and ![a map](map.png) or [ref][1].",
			),
		).toBe("See the essay and a map or ref.");
	});

	it("removes heading markers", () => {
		expect(previewText("# Title\n\n### Part two ###\nBody")).toBe(
			"Title Part two Body",
		);
		expect(previewText("#hashtag stays")).toBe("#hashtag stays");
	});

	it("removes list and quote markers", () => {
		expect(
			previewText("- one\n* two\n+ three\n1. four\n2) five\n- [x] done"),
		).toBe("one two three four five done");
		expect(previewText("> quoted\n> > nested")).toBe("quoted nested");
	});

	it("removes code fences and inline code ticks but keeps the code", () => {
		expect(previewText("Try:\n```ts\nconst x = 1;\n```\nthen `run()`.")).toBe(
			"Try: const x = 1; then run().",
		);
		expect(previewText("~~~\nplain\n~~~")).toBe("plain");
	});

	it("removes horizontal rules", () => {
		expect(previewText("above\n\n---\n\nbelow")).toBe("above below");
	});

	it("removes citation markers", () => {
		expect(
			previewText(
				'The light[[cite locator="ab:v1:2.3" quote="the green light"]] recurs.',
			),
		).toBe("The light recurs.");
	});

	it("removes a citation marker cut off at the end", () => {
		expect(
			previewText('The light recurs [[cite locator="ab:v1:2.3" quote="the gr'),
		).toBe("The light recurs");
	});

	it("leaves literal HTML as plain text", () => {
		expect(previewText('<b>bold</b> <img src=x onerror="alert(1)">')).toBe(
			'<b>bold</b> <img src=x onerror="alert(1)">',
		);
		expect(previewText("<script>\nalert(1)\n</script>")).toBe(
			"<script> alert(1) </script>",
		);
	});

	it("collapses whitespace and line breaks", () => {
		expect(previewText("  one\n\n\ttwo   three \r\n")).toBe("one two three");
		expect(previewText("   \n ")).toBe("");
	});
});
