import type { LanguageModelUsage } from "ai";
import { describe, expect, it } from "vitest";
import { estimateCost, priceFor, priceTable } from "./pricing";
import { addUsage, NO_USAGE, type TokenUsage } from "./record";

function step(u: {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	reasoning?: number;
}): LanguageModelUsage {
	return {
		inputTokens: u.input,
		inputTokenDetails: {
			noCacheTokens: undefined,
			cacheReadTokens: u.cacheRead,
			cacheWriteTokens: u.cacheWrite,
		},
		outputTokens: u.output,
		outputTokenDetails: { textTokens: undefined, reasoningTokens: u.reasoning },
		totalTokens: undefined,
	};
}

const usage = (u: Partial<TokenUsage>): TokenUsage => ({ ...NO_USAGE, ...u });

describe("addUsage", () => {
	it("sums every field over steps", () => {
		const total = [
			step({
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 90,
				reasoning: 4,
			}),
			step({
				input: 150,
				output: 20,
				cacheRead: 90,
				cacheWrite: 50,
				reasoning: 6,
			}),
		].reduce(addUsage, NO_USAGE);
		expect(total).toEqual({
			inputTokens: 250,
			outputTokens: 30,
			cacheReadTokens: 90,
			cacheWriteTokens: 140,
			reasoningTokens: 10,
		});
	});

	it("keeps a field unknown only when no step reported it", () => {
		const total = [
			step({ input: 100, output: 10 }),
			step({ input: 50, output: 5, cacheRead: 40 }),
		].reduce(addUsage, NO_USAGE);
		expect(total).toEqual({
			inputTokens: 150,
			outputTokens: 15,
			cacheReadTokens: 40,
			cacheWriteTokens: null,
			reasoningTokens: null,
		});
	});

	it("is all unknown with no steps or no reports", () => {
		expect([step({})].reduce(addUsage, NO_USAGE)).toEqual(NO_USAGE);
	});
});

describe("pricing", () => {
	it("prices a known model, splitting cached from uncached input", () => {
		// Sonnet 5.5: input 2, cache read 0.1, cache write 2.5, output 10.
		const cost = estimateCost(
			usage({
				inputTokens: 1_000_000,
				cacheReadTokens: 600_000,
				cacheWriteTokens: 100_000,
				outputTokens: 100_000,
			}),
			"claude-sonnet-5-5",
		);
		expect(cost).toBeCloseTo(0.3 * 2 + 0.6 * 0.1 + 0.1 * 2.5 + 0.1 * 10);
	});

	it("matches a dated snapshot id by its longest prefix", () => {
		expect(priceFor("claude-sonnet-4-5-20250929")).toEqual(
			priceFor("claude-sonnet-4-5"),
		);
		// "claude-sonnet-5" also prefixes this id; the longer key wins.
		expect(priceFor("claude-sonnet-5-5-20261001")?.cacheRead).toBe(0.1);
	});

	it("returns null for an unknown model", () => {
		expect(priceFor("llama3.1")).toBeNull();
		expect(estimateCost(usage({ inputTokens: 10 }), "llama3.1")).toBeNull();
	});

	it("lets an override win over the built-in price", () => {
		const table = priceTable({
			"claude-sonnet-5-5": { input: 1, output: 1 },
		});
		expect(
			estimateCost(
				usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
				"claude-sonnet-5-5",
				table,
			),
		).toBeCloseTo(2);
	});

	it("falls back to the input price for missing cache prices", () => {
		const table = priceTable({ local: { input: 4, output: 8 } });
		const cost = estimateCost(
			usage({
				inputTokens: 1_000_000,
				cacheReadTokens: 500_000,
				cacheWriteTokens: 500_000,
			}),
			"local",
			table,
		);
		expect(cost).toBeCloseTo(4);
	});

	it("treats unknown counts as zero once the model is priced", () => {
		expect(estimateCost(NO_USAGE, "claude-haiku-5-5")).toBe(0);
	});
});
