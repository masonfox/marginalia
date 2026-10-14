import {
	type Estimated,
	estimateCost,
	type MessageUsage,
	type PriceTable,
	totalOf,
	type UsageTotal,
	usageForConversation,
} from "#/modules/usage";
import type { Executor } from "#/server/db";
import { type ConversationDetail, getConversation } from "./repository";

export interface ConversationWithUsage extends ConversationDetail {
	/** Recorded usage of each assistant reply, keyed by message id. Replies without usage are absent. */
	usage: Record<string, Estimated<MessageUsage>>;
	usageTotal: UsageTotal;
}

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
	const usage: Record<string, Estimated<MessageUsage>> = {};
	for (const [messageId, u] of Object.entries(recorded.byMessage)) {
		usage[messageId] = {
			...u,
			estimatedCost: estimateCost(u, u.model, prices),
		};
	}
	return { ...conversation, usage, usageTotal: totalOf(recorded, prices) };
}
