CREATE TABLE "preprocess_runs" (
	"edition_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"total_units" integer DEFAULT 0 NOT NULL,
	"done_units" integer DEFAULT 0 NOT NULL,
	"failed_units" integer DEFAULT 0 NOT NULL,
	"model" text,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "preprocess_runs_status_ck" CHECK ("preprocess_runs"."status" in ('queued','running','complete','failed'))
);
--> statement-breakpoint
CREATE TABLE "unit_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"unit_ordinal" integer NOT NULL,
	"end_position" integer NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"kind" text NOT NULL,
	"note" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"parser_version" integer NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"unit_ordinal" integer NOT NULL,
	"unit_label" text NOT NULL,
	"end_position" integer NOT NULL,
	"summary" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"parser_version" integer NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_summaries_edition_unit_uq" UNIQUE("edition_id","unit_ordinal")
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "edition_id" uuid;--> statement-breakpoint
ALTER TABLE "preprocess_runs" ADD CONSTRAINT "preprocess_runs_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_observations" ADD CONSTRAINT "unit_observations_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_summaries" ADD CONSTRAINT "unit_summaries_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_observations_lookup_idx" ON "unit_observations" USING btree ("edition_id","name_key","end_position");--> statement-breakpoint
CREATE INDEX "unit_observations_unit_idx" ON "unit_observations" USING btree ("edition_id","unit_ordinal");--> statement-breakpoint
CREATE INDEX "unit_summaries_bound_idx" ON "unit_summaries" USING btree ("edition_id","end_position");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_edition_idx" ON "ai_usage" USING btree ("edition_id");