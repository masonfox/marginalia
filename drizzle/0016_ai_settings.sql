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