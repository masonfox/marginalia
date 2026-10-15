import { describe, expect, it } from "vitest";
import { buildUnitPrompt, PREVIOUS_SUMMARY_CHARS } from "./prompts";

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
