// The reader layer: durable, reader-owned data keyed by stable identity
// (passage locators and name keys), never by machine row ids. Tables are
// added per phase of the Book Guide change.
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { OBSERVATION_KINDS } from "#/modules/analysis";
import { editions } from "#/modules/library";

/**
 * A reader-authored position (design D2). The locator is the identity;
 * `position` caches that passage's reveal position for SQL comparisons and is
 * recomputed on reparse. Reveal anchors (alias reveals, note "as of",
 * correction unit anchors) are floors: visible when `position <= bound`.
 */
export interface Anchor {
	locator: string;
	position: number;
}

/**
 * How far the reader has read in an edition (design D3). A row exists only
 * while the position is set; both columns null means finished. Same shape and
 * check as `conversation_editions`, so scopes and `rebase` apply unchanged.
 * Shared by everyone on the instance: a reader id would join the key.
 */
export const readingPositions = pgTable(
	"reading_positions",
	{
		editionId: uuid("edition_id")
			.primaryKey()
			.references(() => editions.id, { onDelete: "cascade" }),
		/** A bound (a reveal position); NULL means finished. */
		maxPosition: integer("max_position"),
		/** Label of the reading unit the bound was chosen from; set exactly when the bound is. */
		scopeLabel: text("scope_label"),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check(
			"reading_positions_scope_check",
			sql`(${t.maxPosition} is null) = (${t.scopeLabel} is null)`,
		),
	],
);

/**
 * A reader-confirmed subject (design D3): a group of observation names. A
 * name key with no alias link is its own implicit subject, so a row exists
 * only once the reader links names or sets a kind.
 */
export const guideSubjects = pgTable(
	"guide_subjects",
	{
		id: serial("id").primaryKey(),
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		/** The name key the reader chose to display it under; one of its names. */
		displayKey: text("display_key"),
		/** The reader's kind; null uses the kind its observations carry. */
		kind: text("kind", { enum: OBSERVATION_KINDS }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("guide_subjects_edition_idx").on(t.editionId)],
);

/**
 * Links a name key to its subject. A primary name is always grouped; an
 * alias only from its reveal anchor on (a floor, design D2), so an identity
 * is never disclosed before the reader reaches it.
 */
export const guideSubjectAliases = pgTable(
	"guide_subject_aliases",
	{
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		nameKey: text("name_key").notNull(),
		subjectId: integer("subject_id")
			.notNull()
			.references(() => guideSubjects.id, { onDelete: "cascade" }),
		isPrimary: boolean("is_primary").notNull(),
		/** The reveal anchor's passage; null exactly for the primary name. */
		revealLocator: text("reveal_locator"),
		/** That passage's reveal position, cached; null exactly for the primary name. */
		revealPosition: integer("reveal_position"),
	},
	(t) => [
		primaryKey({ columns: [t.editionId, t.nameKey] }),
		uniqueIndex("guide_subject_aliases_primary_idx")
			.on(t.subjectId)
			.where(sql`${t.isPrimary}`),
		index("guide_subject_aliases_subject_idx").on(t.subjectId),
		check(
			"guide_subject_aliases_reveal_check",
			sql`(${t.revealPosition} is null) = ${t.isPrimary} and (${t.revealLocator} is null) = ${t.isPrimary}`,
		),
	],
);

/** A proposed merge the reader dismissed: never proposed again. Keys are ordered. */
export const guideDismissedProposals = pgTable(
	"guide_dismissed_proposals",
	{
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		keyA: text("key_a").notNull(),
		keyB: text("key_b").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.editionId, t.keyA, t.keyB] }),
		// Code-point order, as the application compares keys.
		check(
			"guide_dismissed_proposals_order_check",
			sql`${t.keyA} < ${t.keyB} collate "C"`,
		),
	],
);

/** A name the reader asked not to be glossed in the passage reader. */
export const guideGlossExclusions = pgTable(
	"guide_gloss_exclusions",
	{
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		nameKey: text("name_key").notNull(),
	},
	(t) => [primaryKey({ columns: [t.editionId, t.nameKey] })],
);
