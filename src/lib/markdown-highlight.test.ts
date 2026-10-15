import { describe, expect, it } from "vitest";
import { highlightMarkdown, type MarkdownStyle } from "./markdown-highlight";

const styled = (value: string) =>
	highlightMarkdown(value).map(({ text, styles }) => [text, styles.join(" ")]);

const textWith = (value: string, style: MarkdownStyle) =>
	highlightMarkdown(value)
		.filter((s) => s.styles.includes(style))
		.map((s) => s.text)
		.join("");

describe("highlightMarkdown", () => {
	it.each([
		"",
		"plain",
		"# Title\n- one\n  2. two\n> quoted **bold**",
		"```ts\nconst a = `x`;\n```\nafter",
		"a *b* _c_ **d** __e__ ~~f~~ `g` [h](https://i.example)\n\n",
		"unclosed **bold and `code",
	])("keeps the text exactly: %j", (value) => {
		expect(
			highlightMarkdown(value)
				.map((s) => s.text)
				.join(""),
		).toBe(value);
	});

	it("styles a heading and dims its marker", () => {
		expect(styled("## A *b*")).toEqual([
			["## ", "heading marker"],
			["A ", "heading"],
			["*", "heading marker"],
			["b", "heading em"],
			["*", "heading marker"],
		]);
	});

	it("dims list markers, bulleted and numbered", () => {
		expect(textWith("- one\n  12. two\n* three", "marker")).toBe("- 12. * ");
	});

	it("does not treat a hashtag or a bare dash as markup", () => {
		expect(
			highlightMarkdown("#tag\n-dash").every((s) => s.styles.length === 0),
		).toBe(true);
	});

	it("styles inline emphasis, code, and links", () => {
		expect(textWith("**strong** and *em*", "strong")).toBe("strong");
		expect(textWith("**strong** and *em*", "em")).toBe("em");
		expect(textWith("a `**not bold**` b", "strong")).toBe("");
		expect(textWith("a `**not bold**` b", "code")).toBe("`**not bold**`");
		expect(textWith("see [here](https://x.example)", "link")).toBe("here");
		expect(textWith("see [here](https://x.example)", "url")).toBe(
			"https://x.example",
		);
	});

	it("leaves underscores inside words alone", () => {
		expect(textWith("snake_case_name", "em")).toBe("");
	});

	it("styles a fenced block as code until it closes", () => {
		expect(textWith("```\n# not a heading\n```\n# heading", "heading")).toBe(
			"# heading",
		);
		expect(textWith("```\n# not a heading", "code")).toBe(
			"```\n# not a heading",
		);
	});
});
