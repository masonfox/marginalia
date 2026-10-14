import { describe, expect, it } from "vitest";
import { describeStep, groupParts, summarizeTrail } from "./research-trail";

const done = (type: string, input: unknown, output: unknown) => ({
	type,
	state: "output-available",
	input,
	output,
});

describe("describeStep: searchBooks", () => {
	it("shows query and count with passages", () => {
		const s = describeStep(
			done(
				"tool-searchBooks",
				{ query: "Shrike" },
				{
					status: "ok",
					count: 2,
					truncated: false,
					results: [
						{
							book: "b1",
							bookTitle: "Hyperion",
							locator: "a:v1:1.2",
							section: "Ch 1",
							position: 3,
							text: "The Shrike",
						},
						{
							book: "b1",
							bookTitle: "Hyperion",
							locator: "a:v1:1.5",
							section: "Ch 2",
							position: 9,
							text: "Tree of Pain",
						},
					],
				},
			),
		);
		expect(s).toMatchObject({
			kind: "search",
			status: "ok",
			detail: "2 results",
		});
		expect(s.label).toContain("Shrike");
		expect(s.passages[0]).toEqual({
			locator: "a:v1:1.2",
			text: "The Shrike",
			section: "Ch 1",
			bookTitle: "Hyperion",
		});
	});

	it("uses singular for one result", () => {
		const s = describeStep(
			done(
				"tool-searchBooks",
				{ query: "x" },
				{ status: "ok", count: 1, results: [{ locator: "l", text: "t" }] },
			),
		);
		expect(s.detail).toBe("1 result");
	});

	it("treats zero results as empty", () => {
		const s = describeStep(
			done(
				"tool-searchBooks",
				{ query: "x" },
				{ status: "ok", count: 0, truncated: false, results: [] },
			),
		);
		expect(s).toMatchObject({ status: "empty", detail: "no matches" });
	});

	it("fails on unknown_book with the message", () => {
		const s = describeStep(
			done(
				"tool-searchBooks",
				{ query: "x", book: "b9" },
				{
					status: "unknown_book",
					message: 'No book "b9" in this conversation.',
					books: [],
				},
			),
		);
		expect(s).toMatchObject({
			status: "failed",
			detail: 'No book "b9" in this conversation.',
		});
	});
});

describe("describeStep: readPassage", () => {
	it("labels with the joined path", () => {
		const s = describeStep(
			done(
				"tool-readPassage",
				{ locator: "a:v1:1.2" },
				{
					status: "ok",
					book: "b1",
					bookTitle: "H",
					section: "Chapter 23",
					path: ["Part Three", "Chapter 23"],
					passage: { locator: "a:v1:1.2", kind: "p", text: "Hi" },
					before: [],
					after: [],
				},
			),
		);
		expect(s.label).toBe("Part Three › Chapter 23");
		expect(s.passages).toHaveLength(1);
		expect(s.passages[0]?.locator).toBe("a:v1:1.2");
	});

	it("falls back to section, then locator", () => {
		const base = { status: "ok", passage: { locator: "l", text: "t" } };
		expect(
			describeStep(
				done(
					"tool-readPassage",
					{ locator: "l" },
					{ ...base, section: "Sec", path: [] },
				),
			).label,
		).toBe("Sec");
		expect(
			describeStep(
				done("tool-readPassage", { locator: "l" }, { ...base, path: [] }),
			).label,
		).toBe("l");
	});

	it.each([
		"not_found",
		"removed",
		"not_in_conversation",
	])("%s is unavailable", (status) => {
		const s = describeStep(
			done("tool-readPassage", { locator: "l" }, { status, locator: "l" }),
		);
		expect(s.status).toBe("unavailable");
		expect(s.passages).toEqual([]);
	});
});

describe("describeStep: other cases", () => {
	it("describes outline", () => {
		const s = describeStep(
			done("tool-getOutline", {}, { status: "ok", outlines: [] }),
		);
		expect(s).toMatchObject({
			kind: "outline",
			status: "ok",
			label: "Browsed the table of contents",
		});
	});

	it("describes unknown tools generically", () => {
		const s = describeStep(done("tool-mystery", {}, { a: 1 }));
		expect(s).toMatchObject({
			kind: "other",
			status: "ok",
			label: "Used mystery",
		});
	});

	it("reports output-error", () => {
		const s = describeStep({
			type: "tool-searchBooks",
			state: "output-error",
			input: { query: "q" },
			errorText: "boom",
		});
		expect(s).toMatchObject({ status: "failed", detail: "boom" });
	});

	it("reports in-progress without output", () => {
		expect(
			describeStep({
				type: "tool-readPassage",
				state: "input-available",
				input: { locator: "l" },
			}),
		).toMatchObject({ status: "running", label: "Reading passage…" });
	});

	it("never throws on malformed output", () => {
		const outputs = [
			null,
			"x",
			5,
			[],
			{ results: "no" },
			{ results: [null, 1, {}] },
		];
		for (const output of outputs) {
			for (const type of [
				"tool-searchBooks",
				"tool-readPassage",
				"tool-getOutline",
			]) {
				expect(() => describeStep(done(type, null, output))).not.toThrow();
			}
		}
	});
});

describe("groupParts / summarizeTrail", () => {
	const tool = (type = "tool-searchBooks") => ({ type });

	it("groups runs, splits at text, ignores other parts", () => {
		const blocks = groupParts([
			tool(),
			{ type: "data-citations" },
			tool("tool-readPassage"),
			{ type: "text", text: "hi" },
			tool(),
		]);
		expect(blocks.map((b) => b.type)).toEqual(["trail", "text", "trail"]);
		const first = blocks[0];
		expect(first?.type === "trail" && first.parts).toHaveLength(2);
	});

	it("does not split on empty text", () => {
		expect(
			groupParts([tool(), { type: "text", text: "" }, tool()]),
		).toHaveLength(1);
	});

	it("summarizes with pluralization and zero counts", () => {
		expect(
			summarizeTrail([
				{ kind: "search" },
				{ kind: "search" },
				{ kind: "read" },
			]),
		).toBe("Researched · 2 searches · 1 passage read");
		expect(summarizeTrail([{ kind: "read" }, { kind: "read" }])).toBe(
			"Researched · 2 passages read",
		);
		expect(summarizeTrail([{ kind: "search" }])).toBe("Researched · 1 search");
		expect(summarizeTrail([{ kind: "outline" }])).toBe("Researched");
	});
});
