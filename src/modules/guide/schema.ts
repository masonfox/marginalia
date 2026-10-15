// The reader layer: durable, reader-owned data keyed by stable identity
// (passage locators and name keys), never by machine row ids. Tables are
// added per phase of the Book Guide change.
import { sql } from "drizzle-orm";
import {
	check,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
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
