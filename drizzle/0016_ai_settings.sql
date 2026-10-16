CREATE TABLE "ai_credentials" (
	"provider" text PRIMARY KEY NOT NULL,
	"api_key_ciphertext" "bytea",
	"api_key_iv" "bytea",
	"api_key_tag" "bytea",
	"api_key_hint" text,
	"base_url" text,
	"secret_key_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credentials_provider_ck" CHECK ("ai_credentials"."provider" in ('openai', 'anthropic', 'google', 'openai-compatible')),
	CONSTRAINT "ai_credentials_key_ck" CHECK (("ai_credentials"."api_key_ciphertext" is null and "ai_credentials"."api_key_iv" is null and "ai_credentials"."api_key_tag" is null) or ("ai_credentials"."api_key_ciphertext" is not null and "ai_credentials"."api_key_iv" is not null and "ai_credentials"."api_key_tag" is not null))
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"chat_provider" text,
	"chat_model" text,
	"preprocess_mode" text,
	"preprocess_provider" text,
	"preprocess_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_single_row_ck" CHECK ("ai_settings"."id" = 1),
	CONSTRAINT "ai_settings_chat_ck" CHECK (("ai_settings"."chat_provider" is null) = ("ai_settings"."chat_model" is null)),
	CONSTRAINT "ai_settings_preprocess_mode_ck" CHECK ("ai_settings"."preprocess_mode" in ('same-as-chat', 'model')),
	CONSTRAINT "ai_settings_preprocess_ck" CHECK (("ai_settings"."preprocess_provider" is null) = ("ai_settings"."preprocess_model" is null) and ("ai_settings"."preprocess_provider" is not null) = ("ai_settings"."preprocess_mode" is not distinct from 'model'))
);
--> statement-breakpoint
ALTER TABLE "preprocess_runs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_provider" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ai_model_check" CHECK (("conversations"."ai_provider" is null) = ("conversations"."ai_model" is null));