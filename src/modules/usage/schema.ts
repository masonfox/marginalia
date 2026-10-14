import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { conversations, messages } from "#/modules/conversation";

/**
 * One row per AI call. Token columns are null when the provider did not
 * report them. A retried failure deletes its message but keeps its row
 * (`message_id` becomes null), so it still counts toward the conversation.
 */
export const aiUsage = pgTable(
	"ai_usage",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		purpose: text("purpose", { enum: ["conversation"] }).notNull(),
		conversationId: uuid("conversation_id").references(() => conversations.id, {
			onDelete: "cascade",
		}),
		messageId: uuid("message_id").references(() => messages.id, {
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
		index("ai_usage_conversation_idx").on(t.conversationId),
		index("ai_usage_message_idx").on(t.messageId),
	],
);
