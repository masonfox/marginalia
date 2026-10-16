import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";
import type { AiProviderName } from "#/server/config";

/**
 * The instance's saved AI defaults: one row (`id = 1`). A null pair means
 * nothing is saved and the environment default applies.
 */
export const aiSettings = pgTable(
	"ai_settings",
	{
		id: smallint("id").primaryKey().default(1),
		chatProvider: text("chat_provider").$type<AiProviderName>(),
		chatModel: text("chat_model"),
		/** Null when nothing is saved; `model` uses the preprocess pair. */
		preprocessMode: text("preprocess_mode", {
			enum: ["same-as-chat", "model"],
		}),
		preprocessProvider: text("preprocess_provider").$type<AiProviderName>(),
		preprocessModel: text("preprocess_model"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check("ai_settings_single_row_ck", sql`${t.id} = 1`),
		check(
			"ai_settings_chat_ck",
			sql`(${t.chatProvider} is null) = (${t.chatModel} is null)`,
		),
		check(
			"ai_settings_preprocess_mode_ck",
			sql`${t.preprocessMode} in ('same-as-chat', 'model')`,
		),
		check(
			"ai_settings_preprocess_ck",
			sql`(${t.preprocessProvider} is null) = (${t.preprocessModel} is null) and (${t.preprocessProvider} is not null) = (${t.preprocessMode} is not distinct from 'model')`,
		),
	],
);
