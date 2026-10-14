CREATE TABLE "excluded_editions" (
	"sha256" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"excluded_at" timestamp with time zone DEFAULT now() NOT NULL
);
