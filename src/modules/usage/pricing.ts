import type { ModelPrice } from "#/server/config";
import type { TokenUsage } from "./record";

/**
 * Built-in prices in USD per million tokens, cache writes at the 5-minute TTL.
 * Copied from https://platform.claude.com/docs/en/about-claude/pricing on
 * 2026-10-14. Operators add or override entries with AI_PRICES.
 * Haiku 5.5's higher price for prompts over 100K tokens is not modeled.
 */
export const BUILTIN_PRICES: Record<string, ModelPrice> = {
	"claude-fable-5-1": {
		input: 10,
		output: 50,
		cacheRead: 0.25,
		cacheWrite: 12.5,
	},
	"claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
	"claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
	"claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	"claude-opus-4-8": {
		input: 5,
		output: 25,
		cacheRead: 0.5,
		cacheWrite: 6.25,
	},
	"claude-sonnet-5-5": {
		input: 2,
		output: 10,
		cacheRead: 0.1,
		cacheWrite: 2.5,
	},
	"claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
	"claude-sonnet-4-6": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
	},
	"claude-sonnet-4-5": {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
	},
	"claude-haiku-5-5": {
		input: 0.1,
		output: 0.5,
		cacheRead: 0.01,
		cacheWrite: 0.125,
	},
	"claude-haiku-4-5": {
		input: 1,
		output: 5,
		cacheRead: 0.1,
		cacheWrite: 1.25,
	},
};

export type PriceTable = Record<string, ModelPrice>;

/** The built-in table with operator overrides applied on top. */
export function priceTable(overrides: PriceTable = {}): PriceTable {
	return { ...BUILTIN_PRICES, ...overrides };
}

/** Exact model id first, then the longest key that prefixes it (dated snapshots). */
export function priceFor(
	model: string,
	table: PriceTable = BUILTIN_PRICES,
): ModelPrice | null {
	const exact = table[model];
	if (exact) return exact;
	let best: string | null = null;
	for (const key of Object.keys(table)) {
		if (model.startsWith(key) && (best === null || key.length > best.length)) {
			best = key;
		}
	}
	return best === null ? null : (table[best] ?? null);
}

/**
 * Estimated cost in USD, or null when the model has no known price. Reasoning
 * tokens are already part of output tokens. A missing cache price falls back
 * to the input price, which over-estimates rather than under-estimates.
 */
export function estimateCost(
	usage: TokenUsage,
	model: string,
	table: PriceTable = BUILTIN_PRICES,
): number | null {
	const price = priceFor(model, table);
	if (!price) return null;
	const cacheRead = usage.cacheReadTokens ?? 0;
	const cacheWrite = usage.cacheWriteTokens ?? 0;
	const noCache = Math.max(
		0,
		(usage.inputTokens ?? 0) - cacheRead - cacheWrite,
	);
	const perToken =
		noCache * price.input +
		cacheRead * (price.cacheRead ?? price.input) +
		cacheWrite * (price.cacheWrite ?? price.input) +
		(usage.outputTokens ?? 0) * price.output;
	return perToken / 1_000_000;
}
