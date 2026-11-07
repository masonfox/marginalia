ALTER TABLE "progress_links" DROP CONSTRAINT "progress_links_matched_by_ck";--> statement-breakpoint
ALTER TABLE "progress_links" ADD COLUMN "applied_reading" jsonb;--> statement-breakpoint
ALTER TABLE "progress_links" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "progress_links" ADD COLUMN "moved_back_from" text;--> statement-breakpoint
ALTER TABLE "progress_links" ADD CONSTRAINT "progress_links_matched_by_ck" CHECK ("progress_links"."matched_by" in ('auto', 'manual', 'rejected'));