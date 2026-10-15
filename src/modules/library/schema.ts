import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { regconfig } from "#/server/db/types";

export const librarySources = pgTable(
	"library_sources",
	{
		id: serial("id").primaryKey(),
		kind: text("kind", { enum: ["upload", "filesystem"] }).notNull(),
		/** Filesystem root, or the uploads directory for the upload source. */
		rootPath: text("root_path").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		unique().on(t.kind, t.rootPath),
		check(
			"library_sources_kind_check",
			sql`${t.kind} in ('upload', 'filesystem')`,
		),
	],
);

export const libraryFiles = pgTable(
	"library_files",
	{
		id: serial("id").primaryKey(),
		sourceId: integer("source_id")
			.notNull()
			.references(() => librarySources.id, { onDelete: "cascade" }),
		relPath: text("rel_path").notNull(),
		size: bigint("size", { mode: "number" }).notNull(),
		mtime: timestamp("mtime", { withTimezone: true, precision: 3 }).notNull(),
		sha256: text("sha256").notNull(),
		status: text("status", { enum: ["available", "missing"] })
			.notNull()
			.default("available"),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		unique().on(t.sourceId, t.relPath),
		index("library_files_sha256_idx").on(t.sha256),
		check(
			"library_files_status_check",
			sql`${t.status} in ('available', 'missing')`,
		),
	],
);

/**
 * Content hashes of deleted editions. Scans skip library files with these
 * bytes; uploading the same bytes removes the row.
 */
export const excludedEditions = pgTable("excluded_editions", {
	sha256: text("sha256").primaryKey(),
	/** Title at deletion, for logs and any future management UI. */
	title: text("title").notNull(),
	excludedAt: timestamp("excluded_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export type EditionStatus = "processing" | "ready" | "failed";

export const editions = pgTable(
	"editions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sha256: text("sha256").notNull().unique(),
		/** First 12 hex characters of sha256, extended to 16 on collision. Used in locators. */
		shortId: text("short_id").notNull().unique(),
		title: text("title").notNull(),
		authors: jsonb("authors").$type<string[]>().notNull().default([]),
		language: text("language"),
		publisher: text("publisher"),
		published: text("published"),
		identifiers: jsonb("identifiers")
			.$type<{ scheme: string | null; value: string }[]>()
			.notNull()
			.default([]),
		description: text("description"),
		coverPath: text("cover_path"),
		epubVersion: text("epub_version"),
		status: text("status", { enum: ["processing", "ready", "failed"] })
			.notNull()
			.default("processing"),
		error: text("error"),
		parserVersion: integer("parser_version"),
		linearPassageCount: integer("linear_passage_count"),
		/**
		 * Bumped each time the edition's structure is replaced, so work derived
		 * from one structure can tell that it has since changed.
		 */
		structureGeneration: integer("structure_generation").notNull().default(0),
		searchConfig: regconfig("search_config"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check(
			"editions_status_check",
			sql`${t.status} in ('processing', 'ready', 'failed')`,
		),
	],
);
