CREATE TABLE "conversation_editions" (
	"conversation_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"max_position" integer,
	CONSTRAINT "conversation_editions_conversation_id_edition_id_pk" PRIMARY KEY("conversation_id","edition_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"title_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finish_reason" text,
	"model" text,
	"prompt_version" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_conversation_id_seq_unique" UNIQUE("conversation_id","seq"),
	CONSTRAINT "messages_role_check" CHECK ("messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
ALTER TABLE "conversation_editions" ADD CONSTRAINT "conversation_editions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_editions" ADD CONSTRAINT "conversation_editions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_editions_edition_idx" ON "conversation_editions" USING btree ("edition_id");