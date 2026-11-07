CREATE TABLE "progress_links" (
	"edition_id" uuid NOT NULL,
	"provider_kind" text NOT NULL,
	"external_id" text NOT NULL,
	"matched_by" text NOT NULL,
	"last_reading" jsonb,
	"last_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_links_edition_id_provider_kind_pk" PRIMARY KEY("edition_id","provider_kind"),
	CONSTRAINT "progress_links_external_uq" UNIQUE("provider_kind","external_id"),
	CONSTRAINT "progress_links_matched_by_ck" CHECK ("progress_links"."matched_by" in ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "progress_providers" (
	"kind" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"priority" smallint NOT NULL,
	"schedule" text DEFAULT 'manual' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_ciphertext" "bytea",
	"secrets_iv" "bytea",
	"secrets_tag" "bytea",
	"secret_key_id" text,
	"last_sync_at" timestamp with time zone,
	"last_sync_matched" integer,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_providers_priority_unique" UNIQUE("priority"),
	CONSTRAINT "progress_providers_schedule_ck" CHECK ("progress_providers"."schedule" in ('manual', '1h', '6h', '24h')),
	CONSTRAINT "progress_providers_secrets_ck" CHECK (("progress_providers"."secrets_ciphertext" is null and "progress_providers"."secrets_iv" is null and "progress_providers"."secrets_tag" is null) or ("progress_providers"."secrets_ciphertext" is not null and "progress_providers"."secrets_iv" is not null and "progress_providers"."secrets_tag" is not null))
);
--> statement-breakpoint
CREATE TABLE "progress_unmatched" (
	"provider_kind" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isbns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reading" jsonb NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progress_unmatched_provider_kind_external_id_pk" PRIMARY KEY("provider_kind","external_id")
);
--> statement-breakpoint
ALTER TABLE "reading_positions" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_positions" ADD COLUMN "source_reading" jsonb;--> statement-breakpoint
ALTER TABLE "reading_positions" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reading_positions" ADD COLUMN "moved_back_from" text;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "koreader_digest" text;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "progress_sync_excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_links" ADD CONSTRAINT "progress_links_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_links" ADD CONSTRAINT "progress_links_provider_kind_progress_providers_kind_fk" FOREIGN KEY ("provider_kind") REFERENCES "public"."progress_providers"("kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_unmatched" ADD CONSTRAINT "progress_unmatched_provider_kind_progress_providers_kind_fk" FOREIGN KEY ("provider_kind") REFERENCES "public"."progress_providers"("kind") ON DELETE cascade ON UPDATE no action;