import {
	type AnyColumn,
	and,
	eq,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import { messages } from "#/modules/conversation";
import type { Executor } from "#/server/db";
import { estimateCost, type PriceTable } from "./pricing";
import type { TokenUsage } from "./record";
import { aiUsage } from "./schema";

/** One reply's recorded usage. */
export interface MessageUsage extends TokenUsage {
	model: string;
	steps: number;
	complete: boolean;
}

export interface ConversationUsage {
	/** Usage of each assistant reply that has a row, keyed by message id. */
	byMessage: Record<string, MessageUsage>;
	/** Sums per model over every row of the conversation, including retried failures. */
	byModel: (TokenUsage & { model: string })[];
	/** Assistant replies with no recorded usage: saved before recording began, or the provider reported none. */
	missing: number;
}

const sum = (column: AnyColumn) => sql<number | null>`sum(${column})::int`;

export async function usageForConversation(
	db: Executor,
	conversationId: string,
): Promise<ConversationUsage> {
	const [rows, models, [unrecorded]] = await Promise.all([
		db
			.select({
				messageId: aiUsage.messageId,
				model: aiUsage.model,
				inputTokens: aiUsage.inputTokens,
				outputTokens: aiUsage.outputTokens,
				cacheReadTokens: aiUsage.cacheReadTokens,
				cacheWriteTokens: aiUsage.cacheWriteTokens,
				reasoningTokens: aiUsage.reasoningTokens,
				steps: aiUsage.steps,
				complete: aiUsage.complete,
			})
			.from(aiUsage)
			.where(
				and(
					eq(aiUsage.conversationId, conversationId),
					isNotNull(aiUsage.messageId),
				),
			),
		db
			.select({
				model: aiUsage.model,
				inputTokens: sum(aiUsage.inputTokens),
				outputTokens: sum(aiUsage.outputTokens),
				cacheReadTokens: sum(aiUsage.cacheReadTokens),
				cacheWriteTokens: sum(aiUsage.cacheWriteTokens),
				reasoningTokens: sum(aiUsage.reasoningTokens),
			})
			.from(aiUsage)
			.where(eq(aiUsage.conversationId, conversationId))
			.groupBy(aiUsage.model)
			.orderBy(aiUsage.model),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(messages)
			.leftJoin(aiUsage, eq(aiUsage.messageId, messages.id))
			.where(
				and(
					eq(messages.conversationId, conversationId),
					eq(messages.role, "assistant"),
					or(
						isNull(aiUsage.id),
						and(isNull(aiUsage.inputTokens), isNull(aiUsage.outputTokens)),
					),
				),
			),
	]);
	const byMessage: Record<string, MessageUsage> = {};
	for (const { messageId, ...usage } of rows) {
		if (messageId && reported(usage)) byMessage[messageId] = usage;
	}
	return { byMessage, byModel: models, missing: unrecorded?.count ?? 0 };
}

/** A row with no input or output count (e.g. a call that failed at once) counts as no usage. */
const reported = (u: TokenUsage) =>
	u.inputTokens !== null || u.outputTokens !== null;

/** Usage with its estimated cost in USD, null when the model has no known price. */
export type Estimated<T> = T & { estimatedCost: number | null };

export interface UsageTotal extends TokenUsage {
	/** Null when any model in the total has no known price. */
	estimatedCost: number | null;
	/** Assistant replies excluded from the total because they have no recorded usage. */
	missing: number;
}

const add = (a: number | null, b: number | null) =>
	a === null && b === null ? null : (a ?? 0) + (b ?? 0);

/** The conversation total across models, with a labeled-estimate cost. */
export function totalOf(
	usage: ConversationUsage,
	prices: PriceTable,
): UsageTotal {
	const total: UsageTotal = {
		inputTokens: null,
		outputTokens: null,
		cacheReadTokens: null,
		cacheWriteTokens: null,
		reasoningTokens: null,
		estimatedCost: usage.byModel.length > 0 ? 0 : null,
		missing: usage.missing,
	};
	for (const { model, ...tokens } of usage.byModel) {
		total.inputTokens = add(total.inputTokens, tokens.inputTokens);
		total.outputTokens = add(total.outputTokens, tokens.outputTokens);
		total.cacheReadTokens = add(total.cacheReadTokens, tokens.cacheReadTokens);
		total.cacheWriteTokens = add(
			total.cacheWriteTokens,
			tokens.cacheWriteTokens,
		);
		total.reasoningTokens = add(total.reasoningTokens, tokens.reasoningTokens);
		const cost = estimateCost(tokens, model, prices);
		total.estimatedCost =
			cost === null || total.estimatedCost === null
				? null
				: total.estimatedCost + cost;
	}
	return total;
}
