import { describe, expect, it } from "vitest";
import {
	buildUnitPrompt,
	PREVIOUS_SUMMARY_CHARS,
	parseUnitOutput,
} from "./prompts";

const prompt = (previousSummary: string | null) =>
	buildUnitPrompt({
		unitLabel: "Two",
		previousSummary,
		passages: [{ locator: "l", text: "Text." }],
	});

describe("buildUnitPrompt", () => {
	it("passes a short previous summary through whole", () => {
		expect(prompt("Anna left.")).toContain("Anna left.");
	});

	it("caps a long previous summary to its end", () => {
		const long = `${"a".repeat(100_000)} The end.`;
		const p = prompt(long);
		expect(p.length).toBeLessThan(PREVIOUS_SUMMARY_CHARS + 200);
		expect(p).toContain("The end.");
		expect(p).toContain("[l] Text.");
	});
});

const cite = { locator: "s:v1:0.0", quote: "Anna sails" };
const reply = (out: object) => JSON.stringify(out);

describe("parseUnitOutput", () => {
	const anna = {
		name: "Anna",
		kind: "character",
		note: "Sails.",
		citations: [cite],
	};

	it("accepts a cited summary and observations", () => {
		const out = parseUnitOutput(
			reply({
				summary: "Anna sails.",
				citations: [cite],
				observations: [anna],
			}),
		);
		expect(out.citations).toEqual([cite]);
		expect(out.observations[0]?.citations).toEqual([cite]);
	});

	it("ignores content after the first complete object", () => {
		const json = reply({ summary: "Anna {sails}.", citations: [cite] });
		for (const tail of ["}", `\n${json}`, "\nNote: {done}"]) {
			const out = parseUnitOutput(`\`\`\`json\n${json}\n\`\`\`${tail}`);
			expect(out.summary).toBe("Anna {sails}.");
		}
	});

	it("rejects an unterminated object", () => {
		expect(() => parseUnitOutput('{"summary": "Anna')).toThrow(/incomplete/);
	});

	it("accepts zero observations", () => {
		const out = parseUnitOutput(
			reply({ summary: "Quiet.", citations: [cite] }),
		);
		expect(out.observations).toEqual([]);
	});

	it("rejects a summary without citations", () => {
		expect(() =>
			parseUnitOutput(reply({ summary: "Anna sails.", observations: [anna] })),
		).toThrow();
		expect(() =>
			parseUnitOutput(
				reply({ summary: "Anna sails.", citations: [], observations: [anna] }),
			),
		).toThrow();
	});

	it("rejects an observation without citations", () => {
		expect(() =>
			parseUnitOutput(
				reply({
					summary: "Anna sails.",
					citations: [cite],
					observations: [{ ...anna, citations: [] }],
				}),
			),
		).toThrow();
	});

	it("rejects a blank quote or locator", () => {
		for (const bad of [
			{ ...cite, quote: "  " },
			{ ...cite, locator: "" },
		]) {
			expect(() =>
				parseUnitOutput(reply({ summary: "Anna sails.", citations: [bad] })),
			).toThrow();
		}
	});
});
