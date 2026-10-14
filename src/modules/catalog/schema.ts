import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	bigserial,
	boolean,
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { passageKinds } from "#/modules/epub";
import { editions } from "#/modules/library";
import { regconfig, tsvector } from "#/server/db/types";

export const sections = pgTable(
	"sections",
	{
		id: serial("id").primaryKey(),
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		spineIndex: integer("spine_index").notNull(),
		href: text("href").notNull(),
		linear: boolean("linear").notNull(),
		title: text("title"),
	},
	(t) => [unique().on(t.editionId, t.spineIndex)],
);

export const passages = pgTable(
	"passages",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		sectionId: integer("section_id")
			.notNull()
			.references(() => sections.id, { onDelete: "cascade" }),
		spineIndex: integer("spine_index").notNull(),
		blockIndex: integer("block_index").notNull(),
		locator: text("locator").notNull(),
		kind: text("kind", { enum: passageKinds }).notNull(),
		text: text("text").notNull(),
		cfi: text("cfi").notNull(),
		elementId: text("element_id"),
		/** Reading-order position; NULL for passages in non-linear sections. */
		position: integer("position"),
		/** Position at which the passage may be revealed (see book-structure spec). */
		revealPosition: integer("reveal_position").notNull(),
		/** Copied from the edition so the generated column needs no join. */
		searchConfig: regconfig("search_config").notNull(),
		tsv: tsvector("tsv")
			.notNull()
			.generatedAlwaysAs(sql`to_tsvector(search_config, text)`),
	},
	(t) => [
		unique().on(t.editionId, t.locator),
		index("passages_tsv_idx").using("gin", t.tsv),
		index("passages_edition_reveal_idx").on(t.editionId, t.revealPosition),
		index("passages_section_block_idx").on(t.sectionId, t.blockIndex),
	],
);

export const tocEntries = pgTable(
	"toc_entries",
	{
		id: serial("id").primaryKey(),
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		parentId: integer("parent_id").references(
			(): AnyPgColumn => tocEntries.id,
			{
				onDelete: "cascade",
			},
		),
		/** Order among siblings. */
		ordinal: integer("ordinal").notNull(),
		depth: integer("depth").notNull(),
		label: text("label").notNull(),
		passageId: bigint("passage_id", { mode: "number" }).references(
			() => passages.id,
			{ onDelete: "set null" },
		),
	},
	(t) => [index("toc_entries_edition_idx").on(t.editionId)],
);

export const noteRefs = pgTable(
	"note_refs",
	{
		fromPassageId: bigint("from_passage_id", { mode: "number" })
			.notNull()
			.references(() => passages.id, { onDelete: "cascade" }),
		toPassageId: bigint("to_passage_id", { mode: "number" })
			.notNull()
			.references(() => passages.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.fromPassageId, t.toPassageId] }),
		index("note_refs_to_idx").on(t.toPassageId),
	],
);

export const locatorMatchKinds = [
	"exact",
	"split",
	"merged",
	"removed",
] as const;
export type LocatorMatchKind = (typeof locatorMatchKinds)[number];

export const locatorAliases = pgTable(
	"locator_aliases",
	{
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		oldLocator: text("old_locator").notNull(),
		/** Current locator holding the old passage's text; NULL when removed. */
		targetLocator: text("target_locator"),
		matchKind: text("match_kind", { enum: locatorMatchKinds }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.editionId, t.oldLocator] }),
		index("locator_aliases_target_idx").on(t.editionId, t.targetLocator),
		check(
			"locator_aliases_match_kind_check",
			sql`${t.matchKind} in ('exact', 'split', 'merged', 'removed')`,
		),
	],
);
