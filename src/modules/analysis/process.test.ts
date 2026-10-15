import { describe, expect, it } from "vitest";
import { chunkPassages, mergeOutputs, verifyCitations } from "./process";
import { parseUnitOutput } from "./prompts";

const promptSize = (chunk: { locator: string; text: string }[]) =>
	chunk.reduce((n, p) => n + p.locator.length + 5 + p.text.length, 0);

describe("chunkPassages", () => {
	it("groups passages under the cap, counting locators", () => {
		const items = ["a", "b", "c"].map((l) => ({
			locator: l,
			text: "x".repeat(40),
		}));
		const chunks = chunkPassages(items, 100);
		expect(chunks.map((c) => c.map((p) => p.locator))).toEqual([
			["a", "b"],
			["c"],
		]);
	});

	it("slices an oversized passage under its own locator", () => {
		const long = "word ".repeat(1000);
		const chunks = chunkPassages(
			[
				{ locator: "s:v1:0.0", text: "Before." },
				{ locator: "s:v1:0.1", text: long },
			],
			300,
		);
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) expect(promptSize(c)).toBeLessThanOrEqual(300);
		const slices = chunks.flat().filter((p) => p.locator === "s:v1:0.1");
		expect(slices.map((p) => p.text).join("")).toBe(long);
		// Citations from any slice verify against the full passage text.
		const byLocator = new Map([["s:v1:0.1", long]]);
		expect(
			verifyCitations([{ locator: "s:v1:0.1", quote: "word word" }], byLocator),
		).toEqual([{ locator: "s:v1:0.1", quote: "word word", verified: true }]);
	});

	it("never splits a surrogate pair", () => {
		const text = "😀".repeat(50);
		const chunks = chunkPassages([{ locator: "l", text }], 21);
		const parts = chunks.flat().map((p) => p.text);
		expect(parts.join("")).toBe(text);
		// Each emoji is two code units; an odd slice would cut one in half.
		for (const part of parts) expect(part.length % 2).toBe(0);
	});
});

describe("mergeOutputs", () => {
	it("keeps a supplied but unverifiable citation as unverified", () => {
		const out = parseUnitOutput(
			JSON.stringify({
				summary: "Anna sails.",
				citations: [{ locator: "a", quote: "Anna sails" }],
				observations: [
					{
						name: "Anna",
						kind: "character",
						note: "Sails.",
						citations: [{ locator: "a", quote: "never said this" }],
					},
				],
			}),
		);
		const result = mergeOutputs(
			{ ordinal: 0, label: "One", endPosition: 0 },
			"m",
			[out],
			new Map([["a", "Anna sails home."]]),
		);
		expect(result.summaryCitations).toEqual([
			{ locator: "a", quote: "Anna sails", verified: true },
		]);
		expect(result.observations[0]?.citations).toEqual([
			{ locator: "a", quote: "never said this", verified: false },
		]);
	});
});
