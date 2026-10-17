CREATE TABLE "guide_dismissed_proposals" (
	"edition_id" uuid NOT NULL,
	"key_a" text NOT NULL,
	"key_b" text NOT NULL,
	CONSTRAINT "guide_dismissed_proposals_edition_id_key_a_key_b_pk" PRIMARY KEY("edition_id","key_a","key_b"),
	CONSTRAINT "guide_dismissed_proposals_order_check" CHECK ("guide_dismissed_proposals"."key_a" < "guide_dismissed_proposals"."key_b" collate "C")
);
--> statement-breakpoint
CREATE TABLE "guide_gloss_exclusions" (
	"edition_id" uuid NOT NULL,
	"name_key" text NOT NULL,
	CONSTRAINT "guide_gloss_exclusions_edition_id_name_key_pk" PRIMARY KEY("edition_id","name_key")
);
--> statement-breakpoint
CREATE TABLE "guide_subject_aliases" (
	"edition_id" uuid NOT NULL,
	"name_key" text NOT NULL,
	"subject_id" integer NOT NULL,
	"is_primary" boolean NOT NULL,
	"reveal_locator" text,
	"reveal_position" integer,
	CONSTRAINT "guide_subject_aliases_edition_id_name_key_pk" PRIMARY KEY("edition_id","name_key"),
	CONSTRAINT "guide_subject_aliases_reveal_check" CHECK (("guide_subject_aliases"."reveal_position" is null) = "guide_subject_aliases"."is_primary" and ("guide_subject_aliases"."reveal_locator" is null) = "guide_subject_aliases"."is_primary")
);
--> statement-breakpoint
CREATE TABLE "guide_subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"edition_id" uuid NOT NULL,
	"display_key" text,
	"kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guide_dismissed_proposals" ADD CONSTRAINT "guide_dismissed_proposals_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_gloss_exclusions" ADD CONSTRAINT "guide_gloss_exclusions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_subject_aliases" ADD CONSTRAINT "guide_subject_aliases_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_subject_aliases" ADD CONSTRAINT "guide_subject_aliases_subject_id_guide_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."guide_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_subjects" ADD CONSTRAINT "guide_subjects_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guide_subject_aliases_primary_idx" ON "guide_subject_aliases" USING btree ("subject_id") WHERE "guide_subject_aliases"."is_primary";--> statement-breakpoint
CREATE INDEX "guide_subject_aliases_subject_idx" ON "guide_subject_aliases" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "guide_subjects_edition_idx" ON "guide_subjects" USING btree ("edition_id");