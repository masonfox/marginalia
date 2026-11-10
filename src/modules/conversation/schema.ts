import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
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
import type { AiProviderName } from "#/server/config";

export type NamingState =
	| "ineligible"
	| "eligible"
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "skipped";

/** A discussion. Its books are the rows of `conversation_editions`. */
export const conversations = pgTable(
	"conversations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		title: text("title").notNull(),
		/** True once the reader renamed it, so the provisional title is never overwritten. */
		titleLocked: boolean("title_locked").notNull().default(false),
		namingState: text("naming_state")
			.$type<NamingState>()
			.notNull()
			.default("ineligible"),
		namingMessageId: uuid("naming_message_id"),
		namingProvider: text("naming_provider").$type<AiProviderName>(),
		namingModel: text("naming_model"),
		namingAttemptId: uuid("naming_attempt_id"),
		namingExpiresAt: timestamp("naming_expires_at", { withTimezone: true }),
		namingDeadline: timestamp("naming_deadline", { withTimezone: true }),
		namingRevision: integer("naming_revision").notNull().default(0),
		/** The conversation's own model; both null means it follows the chat default. */
		aiProvider: text("ai_provider").$type<AiProviderName>(),
		aiModel: text("ai_model"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check(
			"conversations_naming_state_check",
			sql`${t.namingState} in ('ineligible', 'eligible', 'pending', 'running', 'succeeded', 'failed', 'skipped')`,
		),
		check(
			"conversations_naming_capture_check",
			sql`${t.namingState} not in ('pending', 'running', 'succeeded') or (${t.namingMessageId} is not null and ${t.namingProvider} is not null and ${t.namingModel} is not null and ${t.namingExpiresAt} is not null)`,
		),
		check(
			"conversations_naming_attempt_check",
			sql`${t.namingState} not in ('running', 'succeeded') or (${t.namingAttemptId} is not null and ${t.namingDeadline} is not null)`,
		),
		index("conversations_naming_pending_idx")
			.on(t.namingExpiresAt)
			.where(sql`${t.namingState} = 'pending'`),
		index("conversations_naming_running_idx")
			.on(t.namingDeadline)
			.where(sql`${t.namingState} = 'running'`),
		check(
			"conversations_ai_model_check",
			sql`(${t.aiProvider} is null) = (${t.aiModel} is null)`,
		),
		// The order of the conversations list across books.
		index("conversations_recent_idx").on(
			t.updatedAt.desc(),
			t.createdAt.desc(),
			t.id.desc(),
		),
	],
);

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

/**
 * A side thread anchored to text in an assistant reply of the main
 * conversation. Created together with its first message.
 */
export const conversationThreads = pgTable(
	"conversation_threads",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		/** A main-conversation assistant message. */
		anchorMessageId: uuid("anchor_message_id")
			.notNull()
			.references((): AnyPgColumn => messages.id, { onDelete: "cascade" }),
		/** The selected reply text, 1 to 2,000 characters after trimming. */
		anchorQuote: text("anchor_quote").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** Bumped by every message appended to the thread. */
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("conversation_threads_conversation_idx").on(t.conversationId),
		index("conversation_threads_anchor_idx").on(t.anchorMessageId),
		check(
			"conversation_threads_anchor_quote_check",
			sql`char_length(${t.anchorQuote}) between 1 and 2000`,
		),
	],
);

export const messages = pgTable(
	"messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		/** The side thread holding the message; null for the main conversation. */
		threadId: uuid("thread_id").references(
			(): AnyPgColumn => conversationThreads.id,
			{ onDelete: "cascade" },
		),
		/** One gap-free sequence per conversation, shared by the main conversation and its threads. */
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
		/** Provider of the model that produced an assistant reply. */
		provider: text("provider"),
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
		index("messages_conversation_thread_seq_idx").on(
			t.conversationId,
			t.threadId,
			t.seq,
		),
		check("messages_role_check", sql`${t.role} in ('user', 'assistant')`),
	],
);
