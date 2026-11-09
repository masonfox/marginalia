import { type AnyColumn, and, eq, isNull, or, sql } from "drizzle-orm";
import {
	aiUsage,
	type ConversationUsage,
	type Estimated,
	estimateCost,
	type MessageUsage,
	type PriceTable,
	totalOf,
	type UsageTotal,
	usageForConversation,
} from "#/modules/usage";
import type { Executor } from "#/server/db";
import {
	type ConversationDetail,
	getConversation,
	getThreadMessages,
	type ThreadDetail,
} from "./repository";
import { messages } from "./schema";

export interface ConversationWithUsage extends ConversationDetail {
	/** Recorded usage of each assistant reply, keyed by message id. Replies without usage are absent. */
	usage: Record<string, Estimated<MessageUsage>>;
	/** The whole conversation's total, including its threads. */
	usageTotal: UsageTotal;
	namingUsage?: NonNullable<
		Awaited<ReturnType<typeof usageForConversation>>["naming"]
	>;
}

const withCost = (
	byMessage: Record<string, MessageUsage>,
	prices: PriceTable,
): Record<string, Estimated<MessageUsage>> => {
	const usage: Record<string, Estimated<MessageUsage>> = {};
	for (const [messageId, u] of Object.entries(byMessage)) {
		usage[messageId] = {
			...u,
			estimatedCost: estimateCost(u, u.model, prices),
		};
	}
	return usage;
};

/** A conversation with its usage and estimated costs, or null when it does not exist. */
export async function getConversationWithUsage(
	db: Executor,
	conversationId: string,
	prices: PriceTable,
): Promise<ConversationWithUsage | null> {
	const [conversation, recorded] = await Promise.all([
		getConversation(db, conversationId),
		usageForConversation(db, conversationId),
	]);
	if (!conversation) return null;
	return {
		...conversation,
		usage: withCost(recorded.byMessage, prices),
		namingUsage: recorded.naming,
		usageTotal: totalOf(recorded, prices),
	};
}

export interface ThreadWithUsage extends ThreadDetail {
	/** Recorded usage of each of the thread's assistant replies, keyed by message id. */
	usage: Record<string, Estimated<MessageUsage>>;
	/** The thread's own total, including failed attempts that were retried. */
	usageTotal: UsageTotal;
}

const sum = (column: AnyColumn) => sql<number | null>`sum(${column})::int`;

/** Recorded usage of one thread's replies, in the shape `totalOf` sums. */
export async function usageForThread(
	db: Executor,
	conversationId: string,
	threadId: string,
): Promise<ConversationUsage> {
	const ofThread = and(
		eq(aiUsage.threadId, threadId),
		eq(aiUsage.purpose, "conversation"),
	);
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
			.where(ofThread),
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
			.where(ofThread)
			.groupBy(aiUsage.model)
			.orderBy(aiUsage.model),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(messages)
			.leftJoin(
				aiUsage,
				and(
					eq(aiUsage.messageId, messages.id),
					eq(aiUsage.purpose, "conversation"),
				),
			)
			.where(
				and(
					eq(messages.conversationId, conversationId),
					eq(messages.threadId, threadId),
					eq(messages.role, "assistant"),
					or(
						isNull(aiUsage.id),
						and(isNull(aiUsage.inputTokens), isNull(aiUsage.outputTokens)),
					),
				),
			),
	]);
	const byMessage: Record<string, MessageUsage> = {};
	for (const { messageId, ...u } of rows) {
		if (messageId && (u.inputTokens !== null || u.outputTokens !== null))
			byMessage[messageId] = u;
	}
	return { byMessage, byModel: models, missing: unrecorded?.count ?? 0 };
}

/**
 * A thread's own messages with their usage and the thread's running total,
 * or null when the conversation has no such thread. Costs are estimates.
 */
export async function getThreadWithUsage(
	db: Executor,
	conversationId: string,
	threadId: string,
	prices: PriceTable,
): Promise<ThreadWithUsage | null> {
	const [detail, recorded] = await Promise.all([
		getThreadMessages(db, conversationId, threadId),
		usageForThread(db, conversationId, threadId),
	]);
	if (!detail) return null;
	return {
		...detail,
		usage: withCost(recorded.byMessage, prices),
		usageTotal: totalOf(recorded, prices),
	};
}
