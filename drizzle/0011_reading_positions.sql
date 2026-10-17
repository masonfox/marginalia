CREATE TABLE "reading_positions" (
	"edition_id" uuid PRIMARY KEY NOT NULL,
	"max_position" integer,
	"scope_label" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_positions_scope_check" CHECK (("reading_positions"."max_position" is null) = ("reading_positions"."scope_label" is null))
);
--> statement-breakpoint
ALTER TABLE "reading_positions" ADD CONSTRAINT "reading_positions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;