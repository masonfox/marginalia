import type { LanguageModelUsage } from "ai";
import type { Executor } from "#/server/db";
import { aiUsage } from "./schema";

/** Token counts for one AI call. Null means the provider did not report it. */
export interface TokenUsage {
	/** Total input, including cache reads and writes. */
	inputTokens: number | null;
	/** Includes reasoning tokens. */
	outputTokens: number | null;
	cacheReadTokens: number | null;
	cacheWriteTokens: number | null;
	reasoningTokens: number | null;
}

export const NO_USAGE: TokenUsage = {
	inputTokens: null,
	outputTokens: null,
	cacheReadTokens: null,
	cacheWriteTokens: null,
	reasoningTokens: null,
};

/** Unknown only when both sides are unknown; otherwise a missing side counts as zero. */
const plus = (a: number | null, b: number | null | undefined) =>
	a === null && b == null ? null : (a ?? 0) + (b ?? 0);

/** Adds one step's SDK usage to a running total. */
export function addUsage(
	total: TokenUsage,
	step: LanguageModelUsage,
): TokenUsage {
	return {
		inputTokens: plus(total.inputTokens, step.inputTokens),
		outputTokens: plus(total.outputTokens, step.outputTokens),
		cacheReadTokens: plus(
			total.cacheReadTokens,
			step.inputTokenDetails?.cacheReadTokens,
		),
		cacheWriteTokens: plus(
			total.cacheWriteTokens,
			step.inputTokenDetails?.cacheWriteTokens,
		),
		reasoningTokens: plus(
			total.reasoningTokens,
			step.outputTokenDetails?.reasoningTokens,
		),
	};
}

export interface NewUsage extends TokenUsage {
	purpose: "conversation" | "preprocess";
	conversationId: string | null;
	/** Set for `preprocess` rows. */
	editionId?: string | null;
	messageId: string | null;
	provider: string;
	model: string;
	steps: number;
	complete: boolean;
}

export async function recordUsage(db: Executor, row: NewUsage): Promise<void> {
	await db.insert(aiUsage).values(row);
}
