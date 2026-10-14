CREATE TABLE "instance_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "locator_aliases" (
	"edition_id" uuid NOT NULL,
	"old_locator" text NOT NULL,
	"target_locator" text,
	"match_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locator_aliases_edition_id_old_locator_pk" PRIMARY KEY("edition_id","old_locator"),
	CONSTRAINT "locator_aliases_match_kind_check" CHECK ("locator_aliases"."match_kind" in ('exact', 'split', 'merged', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "note_refs" (
	"from_passage_id" bigint NOT NULL,
	"to_passage_id" bigint NOT NULL,
	CONSTRAINT "note_refs_from_passage_id_to_passage_id_pk" PRIMARY KEY("from_passage_id","to_passage_id")
);
--> statement-breakpoint
CREATE TABLE "passages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"edition_id" uuid NOT NULL,
	"section_id" integer NOT NULL,
	"spine_index" integer NOT NULL,
	"block_index" integer NOT NULL,
	"locator" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"cfi" text NOT NULL,
	"element_id" text,
	"position" integer,
	"reveal_position" integer NOT NULL,
	"search_config" "regconfig" NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector(search_config, text)) STORED NOT NULL,
	CONSTRAINT "passages_edition_id_locator_unique" UNIQUE("edition_id","locator")
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"edition_id" uuid NOT NULL,
	"spine_index" integer NOT NULL,
	"href" text NOT NULL,
	"linear" boolean NOT NULL,
	"title" text,
	CONSTRAINT "sections_edition_id_spine_index_unique" UNIQUE("edition_id","spine_index")
);
--> statement-breakpoint
CREATE TABLE "toc_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"edition_id" uuid NOT NULL,
	"parent_id" integer,
	"ordinal" integer NOT NULL,
	"depth" integer NOT NULL,
	"label" text NOT NULL,
	"passage_id" bigint
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"short_id" text NOT NULL,
	"title" text NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language" text,
	"publisher" text,
	"published" text,
	"identifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"cover_path" text,
	"epub_version" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text,
	"parser_version" integer,
	"linear_passage_count" integer,
	"search_config" "regconfig",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editions_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "editions_short_id_unique" UNIQUE("short_id"),
	CONSTRAINT "editions_status_check" CHECK ("editions"."status" in ('processing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "library_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"rel_path" text NOT NULL,
	"size" bigint NOT NULL,
	"mtime" timestamp (3) with time zone NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_files_source_id_rel_path_unique" UNIQUE("source_id","rel_path"),
	CONSTRAINT "library_files_status_check" CHECK ("library_files"."status" in ('available', 'missing'))
);
--> statement-breakpoint
CREATE TABLE "library_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"root_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_sources_kind_root_path_unique" UNIQUE("kind","root_path"),
	CONSTRAINT "library_sources_kind_check" CHECK ("library_sources"."kind" in ('upload', 'filesystem'))
);
--> statement-breakpoint
ALTER TABLE "locator_aliases" ADD CONSTRAINT "locator_aliases_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_refs" ADD CONSTRAINT "note_refs_from_passage_id_passages_id_fk" FOREIGN KEY ("from_passage_id") REFERENCES "public"."passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_refs" ADD CONSTRAINT "note_refs_to_passage_id_passages_id_fk" FOREIGN KEY ("to_passage_id") REFERENCES "public"."passages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toc_entries" ADD CONSTRAINT "toc_entries_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toc_entries" ADD CONSTRAINT "toc_entries_parent_id_toc_entries_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."toc_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toc_entries" ADD CONSTRAINT "toc_entries_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_files" ADD CONSTRAINT "library_files_source_id_library_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."library_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "locator_aliases_target_idx" ON "locator_aliases" USING btree ("edition_id","target_locator");--> statement-breakpoint
CREATE INDEX "note_refs_to_idx" ON "note_refs" USING btree ("to_passage_id");--> statement-breakpoint
CREATE INDEX "passages_tsv_idx" ON "passages" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "passages_edition_reveal_idx" ON "passages" USING btree ("edition_id","reveal_position");--> statement-breakpoint
CREATE INDEX "passages_section_block_idx" ON "passages" USING btree ("section_id","block_index");--> statement-breakpoint
CREATE INDEX "toc_entries_edition_idx" ON "toc_entries" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "library_files_sha256_idx" ON "library_files" USING btree ("sha256");