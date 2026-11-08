ALTER TABLE "progress_links" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "progress_links" ADD COLUMN "last_attempt_at" timestamp with time zone;