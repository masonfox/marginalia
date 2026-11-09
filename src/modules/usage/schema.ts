import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import {
	conversations,
	conversationThreads,
	messages,
} from "#/modules/conversation";
import { editions } from "#/modules/library";

/**
 * One row per AI call. Token columns are null when the provider did not
 * report them. A retried failure deletes its message but keeps its row
 * (`message_id` becomes null), so it still counts toward the conversation.
 */
export const aiUsage = pgTable(
	"ai_usage",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		purpose: text("purpose", {
			enum: ["conversation", "preprocess", "conversation-title"],
		}).notNull(),
		conversationId: uuid("conversation_id").references(() => conversations.id, {
			onDelete: "cascade",
		}),
		/** Set for `preprocess` rows. */
		editionId: uuid("edition_id").references(() => editions.id, {
			onDelete: "cascade",
		}),
		messageId: uuid("message_id").references(() => messages.id, {
			onDelete: "set null",
		}),
		attemptId: uuid("attempt_id"),
		/**
		 * The side thread of a `conversation` row made for a thread reply; kept
		 * when a retry deletes the message, so the thread total still counts it.
		 */
		threadId: uuid("thread_id").references(() => conversationThreads.id, {
			onDelete: "set null",
		}),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		/** Total input, including cache reads and writes. */
		inputTokens: integer("input_tokens"),
		/** Includes reasoning tokens. */
		outputTokens: integer("output_tokens"),
		cacheReadTokens: integer("cache_read_tokens"),
		cacheWriteTokens: integer("cache_write_tokens"),
		reasoningTokens: integer("reasoning_tokens"),
		steps: integer("steps").notNull(),
		/** False when the call was stopped or failed, so steps may be missing. */
		complete: boolean("complete").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("ai_usage_title_attempt_idx")
			.on(t.attemptId)
			.where(sql`${t.purpose} = 'conversation-title'`),
		index("ai_usage_conversation_idx").on(t.conversationId),
		index("ai_usage_message_idx").on(t.messageId),
		index("ai_usage_thread_idx").on(t.threadId),
		index("ai_usage_edition_idx").on(t.editionId),
	],
);
