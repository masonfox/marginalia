import { describe, expect, it } from "vitest";
import {
	exactUsage,
	formatCost,
	formatTokens,
	replyUsageLine,
	totalUsageLine,
	type UsageFigures,
} from "./usage-format";

const figures = (u: Partial<UsageFigures>): UsageFigures => ({
	inputTokens: null,
	outputTokens: null,
	cacheReadTokens: null,
	cacheWriteTokens: null,
	reasoningTokens: null,
	estimatedCost: null,
	...u,
});

describe("usage formatting", () => {
	it.each([
		[950, "950"],
		[1200, "1.2k"],
		[48_210, "48.2k"],
		[1_300_000, "1.3M"],
	])("rounds %d tokens to %s", (n, text) => {
		expect(formatTokens(n)).toBe(text);
	});

	it.each([
		[0.0712, "~$0.07"],
		[0.004, "<$0.01"],
		[0, "~$0.00"],
	])("marks %d dollars as approximate", (usd, text) => {
		expect(formatCost(usd)).toBe(text);
	});

	it("shows a reply's input with its cached share, output, and estimate", () => {
		expect(
			replyUsageLine(
				figures({
					inputTokens: 31_000,
					cacheReadTokens: 27_400,
					outputTokens: 1200,
					estimatedCost: 0.021,
				}),
			),
		).toBe("31.0k in (27.4k cached) · 1.2k out · ~$0.02");
	});

	it("says the cost is unknown for an unpriced model", () => {
		expect(
			replyUsageLine(figures({ inputTokens: 500, outputTokens: 20 })),
		).toBe("500 in · 20 out · cost unknown");
	});

	it("labels the total as an estimate", () => {
		expect(
			totalUsageLine(
				figures({
					inputTokens: 47_000,
					outputTokens: 1200,
					estimatedCost: 0.07,
				}),
			),
		).toBe("48.2k tokens · ~$0.07 est.");
	});

	it("lists exact figures and skips unreported counts", () => {
		expect(
			exactUsage(
				figures({
					inputTokens: 31_012,
					cacheReadTokens: 27_400,
					outputTokens: 1204,
					estimatedCost: 0.02134,
				}),
			),
		).toBe(
			"Input: 31,012\n  cache read: 27,400\nOutput: 1,204\nEstimated cost: $0.0213",
		);
	});
});
