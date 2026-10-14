import { and, asc, desc, eq, notExists, sql } from "drizzle-orm";
import { editions } from "#/modules/library";
import type { Database, Executor } from "#/server/db";
import {
	type CitationRecord,
	conversationEditions,
	conversations,
	type Json,
	messages,
} from "./schema";

export const DEFAULT_TITLE = "New conversation";

export interface ConversationBook {
	editionId: string;
	shortId: string;
	title: string;
	authors: string[];
	ordinal: number;
	/** Spoiler bound for this book; null means unbounded. */
	maxPosition: number | null;
}

export interface ConversationSummary {
	id: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	messageCount: number;
}

export interface StoredMessage {
	id: string;
	seq: number;
	role: "user" | "assistant";
	parts: Json[];
	citations: CitationRecord[];
	finishReason: string | null;
	model: string | null;
	promptVersion: string | null;
	error: string | null;
	createdAt: Date;
}

export interface ConversationDetail {
	id: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	books: ConversationBook[];
	messages: StoredMessage[];
}

/** Creates a conversation scoped to one or more existing editions, in the given order. */
export async function createConversation(
	db: Database,
	input: { editionIds: string[]; title?: string },
): Promise<{ id: string }> {
	const ids = [...new Set(input.editionIds)];
	if (ids.length === 0)
		throw new Error("a conversation needs at least one book");
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(conversations)
			.values({ title: input.title?.trim() || DEFAULT_TITLE })
			.returning({ id: conversations.id });
		if (!row) throw new Error("could not create conversation");
		await tx.insert(conversationEditions).values(
			ids.map((editionId, ordinal) => ({
				conversationId: row.id,
				editionId,
				ordinal,
			})),
		);
		return row;
	});
}

/** Conversations that include the edition, most recently active first. */
export async function listConversationsForEdition(
	db: Executor,
	editionId: string,
): Promise<ConversationSummary[]> {
	const count = sql<number>`(select count(*)::int from ${messages} where ${messages.conversationId} = ${conversations.id})`;
	return db
		.select({
			id: conversations.id,
			title: conversations.title,
			createdAt: conversations.createdAt,
			updatedAt: conversations.updatedAt,
			messageCount: count,
		})
		.from(conversations)
		.innerJoin(
			conversationEditions,
			eq(conversationEditions.conversationId, conversations.id),
		)
		.where(eq(conversationEditions.editionId, editionId))
		.orderBy(desc(conversations.updatedAt), desc(conversations.createdAt));
}

/** The books a conversation is scoped to, in order. */
export async function getConversationBooks(
	db: Executor,
	conversationId: string,
): Promise<ConversationBook[]> {
	return db
		.select({
			editionId: editions.id,
			shortId: editions.shortId,
			title: editions.title,
			authors: editions.authors,
			ordinal: conversationEditions.ordinal,
			maxPosition: conversationEditions.maxPosition,
		})
		.from(conversationEditions)
		.innerJoin(editions, eq(editions.id, conversationEditions.editionId))
		.where(eq(conversationEditions.conversationId, conversationId))
		.orderBy(asc(conversationEditions.ordinal));
}

export async function getMessages(
	db: Executor,
	conversationId: string,
): Promise<StoredMessage[]> {
	return db
		.select({
			id: messages.id,
			seq: messages.seq,
			role: messages.role,
			parts: messages.parts,
			citations: messages.citations,
			finishReason: messages.finishReason,
			model: messages.model,
			promptVersion: messages.promptVersion,
			error: messages.error,
			createdAt: messages.createdAt,
		})
		.from(messages)
		.where(eq(messages.conversationId, conversationId))
		.orderBy(asc(messages.seq));
}

/** A conversation with its books and messages, or null when it does not exist. */
export async function getConversation(
	db: Executor,
	conversationId: string,
): Promise<ConversationDetail | null> {
	const [row] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, conversationId));
	if (!row) return null;
	const [books, msgs] = await Promise.all([
		getConversationBooks(db, conversationId),
		getMessages(db, conversationId),
	]);
	return {
		id: row.id,
		title: row.title,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		books,
		messages: msgs,
	};
}

/** Renames a conversation and stops provisional titles from replacing the name. */
export async function renameConversation(
	db: Executor,
	conversationId: string,
	title: string,
): Promise<boolean> {
	const trimmed = title.trim();
	if (!trimmed) return false;
	const rows = await db
		.update(conversations)
		.set({ title: trimmed, titleLocked: true })
		.where(eq(conversations.id, conversationId))
		.returning({ id: conversations.id });
	return rows.length > 0;
}

/** Sets the title from the first user message, unless the conversation was renamed. */
export async function setProvisionalTitle(
	db: Executor,
	conversationId: string,
	text: string,
): Promise<boolean> {
	const title = text.replace(/\s+/g, " ").trim().slice(0, 60);
	if (!title) return false;
	const rows = await db
		.update(conversations)
		.set({ title })
		.where(
			and(
				eq(conversations.id, conversationId),
				eq(conversations.titleLocked, false),
				eq(conversations.title, DEFAULT_TITLE),
			),
		)
		.returning({ id: conversations.id });
	return rows.length > 0;
}

export async function deleteConversation(
	db: Executor,
	conversationId: string,
): Promise<boolean> {
	const rows = await db
		.delete(conversations)
		.where(eq(conversations.id, conversationId))
		.returning({ id: conversations.id });
	return rows.length > 0;
}

/**
 * Deletes conversations that no longer have any book (after editions were
 * removed). Returns how many were deleted.
 */
export async function pruneEmptyConversations(db: Executor): Promise<number> {
	const rows = await db
		.delete(conversations)
		.where(
			notExists(
				db
					.select({ one: sql`1` })
					.from(conversationEditions)
					.where(eq(conversationEditions.conversationId, conversations.id)),
			),
		)
		.returning({ id: conversations.id });
	return rows.length;
}

export interface NewMessage {
	conversationId: string;
	role: "user" | "assistant";
	parts: Json[];
	citations?: CitationRecord[];
	finishReason?: string | null;
	model?: string | null;
	promptVersion?: string | null;
	error?: string | null;
}

/** Appends a message with the next sequence number and bumps the conversation's activity time. */
export async function appendMessage(
	db: Database,
	m: NewMessage,
): Promise<{ id: string; seq: number }> {
	return db.transaction(async (tx) => {
		// Serialize appends per conversation so `seq` stays gap-free.
		await tx
			.select({ id: conversations.id })
			.from(conversations)
			.where(eq(conversations.id, m.conversationId))
			.for("update");
		const [{ next }] = await tx
			.select({ next: sql<number>`coalesce(max(${messages.seq}), 0) + 1` })
			.from(messages)
			.where(eq(messages.conversationId, m.conversationId))
			.then((r) => r as [{ next: number }]);
		const [row] = await tx
			.insert(messages)
			.values({
				conversationId: m.conversationId,
				seq: next,
				role: m.role,
				parts: m.parts,
				citations: m.citations ?? [],
				finishReason: m.finishReason ?? null,
				model: m.model ?? null,
				promptVersion: m.promptVersion ?? null,
				error: m.error ?? null,
			})
			.returning({ id: messages.id, seq: messages.seq });
		if (!row) throw new Error("could not append message");
		await tx
			.update(conversations)
			.set({ updatedAt: new Date() })
			.where(eq(conversations.id, m.conversationId));
		return row;
	});
}

/** Starts a conversation about one ready book. Returns null when the book does not exist or is not ready. */
export async function createConversationForEdition(
	db: Database,
	editionId: string,
): Promise<{ id: string } | null> {
	const [edition] = await db
		.select({ id: editions.id, status: editions.status })
		.from(editions)
		.where(eq(editions.id, editionId));
	if (!edition || edition.status !== "ready") return null;
	return createConversation(db, { editionIds: [editionId] });
}
