import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	json,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { editions } from "#/modules/library";

/** A discussion. Its books are the rows of `conversation_editions`. */
export const conversations = pgTable("conversations", {
	id: uuid("id").primaryKey().defaultRandom(),
	title: text("title").notNull(),
	/** True once the reader renamed it, so the provisional title is never overwritten. */
	titleLocked: boolean("title_locked").notNull().default(false),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * The books a conversation is scoped to. The UI creates one row per
 * conversation; nothing else assumes that.
 */
export const conversationEditions = pgTable(
	"conversation_editions",
	{
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		ordinal: integer("ordinal").notNull(),
		/** Per-book spoiler bound (a reveal position); NULL means whole book. */
		maxPosition: integer("max_position"),
		/** Label of the reading unit the bound was chosen from; set exactly when the bound is. */
		scopeLabel: text("scope_label"),
	},
	(t) => [
		primaryKey({ columns: [t.conversationId, t.editionId] }),
		index("conversation_editions_edition_idx").on(t.editionId),
		check(
			"conversation_editions_scope_check",
			sql`(${t.maxPosition} is null) = (${t.scopeLabel} is null)`,
		),
	],
);

/** A JSON value, so stored data stays serializable for server functions. */
export type Json =
	| string
	| number
	| boolean
	| null
	| Json[]
	| { [key: string]: Json };

export type CitationStatus =
	| "verified"
	| "not_found"
	| "quote_mismatch"
	| "removed"
	| "not_in_conversation";

/** A citation marker checked on the server. The stored verdict is the UI's authority. */
export interface CitationRecord {
	editionId: string | null;
	locator: string;
	currentLocator: string | null;
	quote: string;
	status: CitationStatus;
	/** Title of the book and section holding the passage, for display. */
	bookTitle?: string;
	sectionTitle?: string | null;
	/** Character range of the quote inside the passage text, when verified. */
	range?: { start: number; end: number };
}

/** One book's map as a reply recorded it: enough to describe it and tell whether it changed since. */
export interface GuideContextEntry {
	editionId: string;
	/** The book's scope label when the map was sent; null for the whole book. */
	scopeLabel: string | null;
	/** The bound the map was read at; null for the whole book. */
	maxPosition: number | null;
	/** sha256 of the book's rendered map block. */
	mapFingerprint: string;
}

export const messages = pgTable(
	"messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		role: text("role", { enum: ["user", "assistant"] }).notNull(),
		/**
		 * AI SDK UIMessage parts, stored verbatim. `json`, not `jsonb`: jsonb
		 * reorders object keys, so replayed tool results would differ from what
		 * the model was first sent and miss the prompt cache.
		 */
		parts: json("parts").$type<Json[]>().notNull(),
		citations: jsonb("citations")
			.$type<CitationRecord[]>()
			.notNull()
			.default([]),
		finishReason: text("finish_reason"),
		model: text("model"),
		promptVersion: text("prompt_version"),
		error: text("error"),
		/**
		 * The book maps an assistant reply was generated with, one entry per
		 * book that had one; null when none did. The map text is not stored.
		 */
		guideContext: jsonb("guide_context").$type<GuideContextEntry[]>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		unique().on(t.conversationId, t.seq),
		check("messages_role_check", sql`${t.role} in ('user', 'assistant')`),
	],
);
