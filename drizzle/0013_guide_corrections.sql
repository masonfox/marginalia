CREATE TABLE "guide_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"edition_id" uuid NOT NULL,
	"target" text NOT NULL,
	"unit_locator" text NOT NULL,
	"name_key" text,
	"action" text NOT NULL,
	"text" text,
	"citation" jsonb,
	"fingerprint" text NOT NULL,
	"detached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_corrections_target_check" CHECK ("guide_corrections"."target" in ('summary','observation') and ("guide_corrections"."name_key" is null) = ("guide_corrections"."target" = 'summary')),
	CONSTRAINT "guide_corrections_action_check" CHECK ("guide_corrections"."action" in ('replace','suppress') and ("guide_corrections"."text" is null) = ("guide_corrections"."action" = 'suppress') and ("guide_corrections"."citation" is null or "guide_corrections"."action" = 'replace'))
);
--> statement-breakpoint
ALTER TABLE "guide_corrections" ADD CONSTRAINT "guide_corrections_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guide_corrections_key_idx" ON "guide_corrections" USING btree ("edition_id","target","unit_locator",coalesce("name_key", ''));