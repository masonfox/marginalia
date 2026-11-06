import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
	aiUsage,
	type ConversationUsage,
	type NamingUsage,
	type PriceTable,
	totalOf,
} from "#/modules/usage";
import type { Executor } from "#/server/db";
import { conversations, messages } from "./schema";
import { expireTitles } from "./title";

/** Fixed query count for a bounded batch; no histories or message bodies cross the wire. */
export async function readNamingMetadata(
	db: Executor,
	ids: string[],
	prices: PriceTable,
) {
	if (ids.length < 1 || ids.length > 100)
		throw new Error("Expected 1 to 100 conversation ids");
	await expireTitles(db);
	const uniqueIds = [...new Set(ids)];
	const [parents, models, namingRows, missingReplies] = await Promise.all([
		db
			.select({
				id: conversations.id,
				title: conversations.title,
				namingState: conversations.namingState,
				titleLocked: conversations.titleLocked,
				namingExpiresAt: conversations.namingExpiresAt,
				namingDeadline: conversations.namingDeadline,
				namingRevision: conversations.namingRevision,
				namingAttemptId: conversations.namingAttemptId,
			})
			.from(conversations)
			.where(inArray(conversations.id, uniqueIds)),
		db
			.select({
				conversationId: aiUsage.conversationId,
				model: aiUsage.model,
				inputTokens: sql<number | null>`sum(${aiUsage.inputTokens})::int`,
				outputTokens: sql<number | null>`sum(${aiUsage.outputTokens})::int`,
				cacheReadTokens: sql<
					number | null
				>`sum(${aiUsage.cacheReadTokens})::int`,
				cacheWriteTokens: sql<
					number | null
				>`sum(${aiUsage.cacheWriteTokens})::int`,
				reasoningTokens: sql<
					number | null
				>`sum(${aiUsage.reasoningTokens})::int`,
			})
			.from(aiUsage)
			.where(inArray(aiUsage.conversationId, uniqueIds))
			.groupBy(aiUsage.conversationId, aiUsage.model),
		db
			.select({
				conversationId: aiUsage.conversationId,
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
					inArray(aiUsage.conversationId, uniqueIds),
					eq(aiUsage.purpose, "conversation-title"),
				),
			),
		db
			.select({
				conversationId: messages.conversationId,
				count: sql<number>`count(*)::int`,
			})
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
					inArray(messages.conversationId, uniqueIds),
					eq(messages.role, "assistant"),
					or(
						isNull(aiUsage.id),
						and(isNull(aiUsage.inputTokens), isNull(aiUsage.outputTokens)),
					),
				),
			)
			.groupBy(messages.conversationId),
	]);
	return parents.map((row) => {
		const rows = namingRows
			.filter((u) => u.conversationId === row.id)
			.map(({ conversationId: _, ...usage }) => usage);
		const missing =
			!!row.namingAttemptId &&
			!["pending", "running"].includes(row.namingState) &&
			rows.length === 0;
		const naming: NamingUsage = {
			rows,
			missing,
			incomplete: missing || rows.some((r) => !r.complete),
			unknown:
				missing ||
				rows.some((r) => r.inputTokens === null || r.outputTokens === null),
		};
		const usage: ConversationUsage = {
			byMessage: {},
			byModel: models.filter((u) => u.conversationId === row.id),
			missing:
				missingReplies.find((u) => u.conversationId === row.id)?.count ?? 0,
			naming,
		};
		return {
			id: row.id,
			title: row.title,
			naming: {
				state: row.namingState,
				locked: row.titleLocked,
				expiresAt: row.namingExpiresAt,
				deadline: row.namingDeadline,
				revision: row.namingRevision,
			},
			namingUsage: naming,
			usageTotal: totalOf(usage, prices),
		};
	});
}
export type NamingPatch = Awaited<
	ReturnType<typeof readNamingMetadata>
>[number];
