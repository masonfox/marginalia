import { describe, expect, it } from "vitest";
import { normalizeText, normalizeWithOffsets } from "#/modules/epub";
import { matchLocators } from "./matching";

const v = (version: number, texts: string[]) =>
	texts.map((text, i) => ({ locator: `abc:v${version}:${i}`, text }));

const para = (topic: string) =>
	`The ${topic} was described at length by the narrator, who spared no detail of its long history.`;

describe("normalizeText", () => {
	it("folds typography, whitespace, and case", () => {
		expect(normalizeText("  “So we beat on,” she said—boats… ")).toBe(
			'"so we beat on," she said-boats...',
		);
	});

	it("maps normalized characters back to original offsets", () => {
		const original = "A  “Quote” here";
		const { text, offsets } = normalizeWithOffsets(original);
		expect(text).toBe('a "quote" here');
		const start = text.indexOf('"quote"');
		expect(original.slice(offsets[start], offsets[start + 7])).toBe("“Quote”");
	});
});

describe("matchLocators", () => {
	it("maps renumbered but identical passages exactly", () => {
		const old = v(1, ["Chapter 1", para("house"), para("garden")]);
		const now = v(2, [
			"Front matter added.",
			"Chapter 1",
			para("house"),
			para("garden"),
		]);
		const m = matchLocators(old, now);
		expect(Object.fromEntries(m)).toEqual({
			"abc:v1:0": { target: "abc:v2:1", kind: "exact" },
			"abc:v1:1": { target: "abc:v2:2", kind: "exact" },
			"abc:v1:2": { target: "abc:v2:3", kind: "exact" },
		});
	});

	it("maps repeated text to its own occurrence", () => {
		const refrain = "Nevermore, quoth the raven, and nothing more.";
		const old = v(1, [
			"One",
			refrain,
			para("first"),
			"Two",
			refrain,
			para("second"),
		]);
		const now = v(2, [
			"Preface",
			"One",
			refrain,
			para("first"),
			"Two",
			refrain,
			para("second"),
		]);
		const m = matchLocators(old, now);
		expect(m.get("abc:v1:1")?.target).toBe("abc:v2:2");
		expect(m.get("abc:v1:4")?.target).toBe("abc:v2:5");
	});

	it("maps a split passage to the piece holding its beginning", () => {
		const first = "It was the best of times, it was the worst of times.";
		const second = "It was the age of wisdom, it was the age of foolishness.";
		const old = v(1, [
			"Intro",
			`${first} ${second}`,
			"Outro paragraph text here.",
		]);
		const now = v(2, ["Intro", first, second, "Outro paragraph text here."]);
		expect(matchLocators(old, now).get("abc:v1:1")).toEqual({
			target: "abc:v2:1",
			kind: "split",
		});
	});

	it("maps both merged passages to the merged passage", () => {
		const a = "Call me Ishmael, some years ago never mind how long precisely.";
		const b = "Having little or no money in my purse, I thought I would sail.";
		const old = v(1, ["Intro", a, b, "Outro"]);
		const now = v(2, ["Intro", `${a} ${b}`, "Outro"]);
		const m = matchLocators(old, now);
		expect(m.get("abc:v1:1")).toEqual({ target: "abc:v2:1", kind: "merged" });
		expect(m.get("abc:v1:2")).toEqual({ target: "abc:v2:1", kind: "merged" });
	});

	it("records a passage whose text is gone as removed", () => {
		const old = v(1, [
			"Intro",
			"Boilerplate: produced by volunteers.",
			para("story"),
		]);
		const now = v(2, ["Intro", para("story")]);
		expect(matchLocators(old, now).get("abc:v1:1")).toEqual({
			target: null,
			kind: "removed",
		});
	});

	it("matches across typographic differences", () => {
		const old = v(1, ["“Quoted”—text"]);
		const now = v(2, ['"quoted"-text']);
		expect(matchLocators(old, now).get("abc:v1:0")?.kind).toBe("exact");
	});

	it("is deterministic", () => {
		const old = v(1, ["Intro", para("a"), para("b"), "x y", para("c")]);
		const now = v(2, ["Intro", `${para("a")} ${para("b")}`, para("c"), "new"]);
		const runs = [1, 2, 3].map(() =>
			JSON.stringify([...matchLocators(old, now)]),
		);
		expect(new Set(runs).size).toBe(1);
	});
});
