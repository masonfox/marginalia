CREATE TABLE "reader_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"edition_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"as_of_kind" text NOT NULL,
	"as_of_locator" text,
	"as_of_position" integer,
	"as_of_label" text,
	"subject_key" text,
	"unit_locator" text,
	"source_conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reader_notes_as_of_check" CHECK ("reader_notes"."as_of_kind" in ('unit','passage','end') and ("reader_notes"."as_of_locator" is null) = ("reader_notes"."as_of_kind" = 'end') and ("reader_notes"."as_of_position" is null) = ("reader_notes"."as_of_kind" = 'end')),
	CONSTRAINT "reader_notes_attachment_check" CHECK ("reader_notes"."subject_key" is null or "reader_notes"."unit_locator" is null)
);
--> statement-breakpoint
ALTER TABLE "reader_notes" ADD CONSTRAINT "reader_notes_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_notes" ADD CONSTRAINT "reader_notes_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_notes_edition_idx" ON "reader_notes" USING btree ("edition_id","as_of_position");