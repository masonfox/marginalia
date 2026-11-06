import { type Column, getTableName, inArray, sql } from "drizzle-orm";
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

/** Table-qualified, since single-table selects render bare column names. */
const q = (column: Column) =>
	sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;

/** One read statement for a bounded batch; no histories or message bodies cross the wire. */
export async function readNamingMetadata(
	db: Executor,
	ids: string[],
	prices: PriceTable,
) {
	if (ids.length < 1 || ids.length > 100)
		throw new Error("Expected 1 to 100 conversation ids");
	await expireTitles(db);
	const uniqueIds = [...new Set(ids)];
	// One statement, so state and accounting come from a single snapshot: a
	// concurrent finalizeTitle commit is either wholly visible or not at all.
	const parents = await db
		.select({
			id: conversations.id,
			title: conversations.title,
			namingState: conversations.namingState,
			titleLocked: conversations.titleLocked,
			namingExpiresAt: conversations.namingExpiresAt,
			namingDeadline: conversations.namingDeadline,
			namingRevision: conversations.namingRevision,
			namingAttemptId: conversations.namingAttemptId,
			byModel: sql<ConversationUsage["byModel"]>`(
				select coalesce(json_agg(m), '[]'::json) from (
					select ${q(aiUsage.model)} as "model",
						sum(${q(aiUsage.inputTokens)})::int as "inputTokens",
						sum(${q(aiUsage.outputTokens)})::int as "outputTokens",
						sum(${q(aiUsage.cacheReadTokens)})::int as "cacheReadTokens",
						sum(${q(aiUsage.cacheWriteTokens)})::int as "cacheWriteTokens",
						sum(${q(aiUsage.reasoningTokens)})::int as "reasoningTokens"
					from ${aiUsage}
					where ${q(aiUsage.conversationId)} = ${q(conversations.id)}
					group by ${q(aiUsage.model)}
				) m
			)`,
			namingRows: sql<NamingUsage["rows"]>`(
				select coalesce(json_agg(json_build_object(
					'model', ${q(aiUsage.model)},
					'inputTokens', ${q(aiUsage.inputTokens)},
					'outputTokens', ${q(aiUsage.outputTokens)},
					'cacheReadTokens', ${q(aiUsage.cacheReadTokens)},
					'cacheWriteTokens', ${q(aiUsage.cacheWriteTokens)},
					'reasoningTokens', ${q(aiUsage.reasoningTokens)},
					'steps', ${q(aiUsage.steps)},
					'complete', ${q(aiUsage.complete)}
				)), '[]'::json)
				from ${aiUsage}
				where ${q(aiUsage.conversationId)} = ${q(conversations.id)}
					and ${q(aiUsage.purpose)} = 'conversation-title'
			)`,
			missingReplies: sql<number>`(
				select count(*)::int
				from ${messages}
				left join ${aiUsage}
					on ${q(aiUsage.messageId)} = ${q(messages.id)}
					and ${q(aiUsage.purpose)} = 'conversation'
				where ${q(messages.conversationId)} = ${q(conversations.id)}
					and ${q(messages.role)} = 'assistant'
					and (${q(aiUsage.id)} is null
						or (${q(aiUsage.inputTokens)} is null and ${q(aiUsage.outputTokens)} is null))
			)`,
		})
		.from(conversations)
		.where(inArray(conversations.id, uniqueIds));
	return parents.map((row) => {
		const rows = row.namingRows;
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
			byModel: row.byModel,
			missing: row.missingReplies,
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
