CREATE TABLE "conversation_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"anchor_message_id" uuid NOT NULL,
	"anchor_quote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_threads_anchor_quote_check" CHECK (char_length("conversation_threads"."anchor_quote") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_anchor_message_id_messages_id_fk" FOREIGN KEY ("anchor_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_threads_conversation_idx" ON "conversation_threads" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_threads_anchor_idx" ON "conversation_threads" USING btree ("anchor_message_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_conversation_thread_seq_idx" ON "messages" USING btree ("conversation_id","thread_id","seq");--> statement-breakpoint
CREATE INDEX "ai_usage_thread_idx" ON "ai_usage" USING btree ("thread_id");