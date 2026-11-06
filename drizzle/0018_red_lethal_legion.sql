ALTER TABLE "conversations" ADD COLUMN "naming_state" text DEFAULT 'ineligible' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "naming_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "naming_provider" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "naming_model" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "naming_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "naming_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "naming_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "naming_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
CREATE INDEX "conversations_naming_pending_idx" ON "conversations" USING btree ("naming_expires_at") WHERE "conversations"."naming_state" = 'pending';--> statement-breakpoint
CREATE INDEX "conversations_naming_running_idx" ON "conversations" USING btree ("naming_deadline") WHERE "conversations"."naming_state" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_title_attempt_idx" ON "ai_usage" USING btree ("attempt_id") WHERE "ai_usage"."purpose" = 'conversation-title';--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_naming_state_check" CHECK ("conversations"."naming_state" in ('ineligible', 'eligible', 'pending', 'running', 'succeeded', 'failed', 'skipped'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_naming_capture_check" CHECK ("conversations"."naming_state" not in ('pending', 'running', 'succeeded') or ("conversations"."naming_message_id" is not null and "conversations"."naming_provider" is not null and "conversations"."naming_model" is not null and "conversations"."naming_expires_at" is not null));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_naming_attempt_check" CHECK ("conversations"."naming_state" not in ('running', 'succeeded') or ("conversations"."naming_attempt_id" is not null and "conversations"."naming_deadline" is not null));