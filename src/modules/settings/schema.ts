import { sql } from "drizzle-orm";
import {
	check,
	customType,
	pgTable,
	smallint,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import type { AiProviderName } from "#/server/config";

/**
 * The instance's saved AI defaults: one row (`id = 1`). A null pair means
 * no chat default, or preprocessing follows chat.
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

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType: () => "bytea",
});
export const aiCredentials = pgTable(
	"ai_credentials",
	{
		provider: text("provider").$type<AiProviderName>().primaryKey(),
		apiKeyCiphertext: bytea("api_key_ciphertext"),
		apiKeyIv: bytea("api_key_iv"),
		apiKeyTag: bytea("api_key_tag"),
		apiKeyHint: text("api_key_hint"),
		baseUrl: text("base_url"),
		secretKeyId: text("secret_key_id"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check(
			"ai_credentials_provider_ck",
			sql`${t.provider} in ('openai', 'anthropic', 'google', 'openai-compatible')`,
		),
		check(
			"ai_credentials_key_ck",
			sql`(${t.apiKeyCiphertext} is null and ${t.apiKeyIv} is null and ${t.apiKeyTag} is null) or (${t.apiKeyCiphertext} is not null and ${t.apiKeyIv} is not null and ${t.apiKeyTag} is not null)`,
		),
	],
);
