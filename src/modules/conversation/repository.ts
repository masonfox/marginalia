import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	lt,
	notExists,
	type SQL,
	sql,
} from "drizzle-orm";
import { getReadingUnits } from "#/modules/catalog";
import { editions } from "#/modules/library";
import type { Database, Executor } from "#/server/db";
import {
	type CitationRecord,
	conversationEditions,
	conversations,
	type GuideContextEntry,
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
	/** Spoiler bound for this book; null means whole book. */
	maxPosition: number | null;
	/** The reading unit the reader has read through; null exactly when `maxPosition` is. */
	scopeLabel: string | null;
}

/** How far the reader has read in a book: a reading unit, by its end position, or the whole book. */
export type Scope = { kind: "whole" } | { kind: "unit"; endPosition: number };

/** A stored bound: null for whole book. */
export type ResolvedScope = { maxPosition: number; scopeLabel: string } | null;

export interface ConversationSummary {
	id: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	messageCount: number;
	/** Scope of the listed book in this conversation; null means whole book. */
	scopeLabel: string | null;
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
	/** The book maps an assistant reply was generated with; null when none, and for older replies. */
	guideContext: GuideContextEntry[] | null;
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

/**
 * Creates a conversation scoped to one or more existing editions, in the
 * given order. `scopes` holds already resolved bounds by edition id; books
 * without one are whole book.
 */
export async function createConversation(
	db: Database,
	input: NewConversation,
): Promise<{ id: string }> {
	return db.transaction((tx) => insertConversation(tx, input));
}

interface NewConversation {
	editionIds: string[];
	title?: string;
	scopes?: Record<string, ResolvedScope>;
}

/** createConversation's writes; the caller provides the transaction. */
async function insertConversation(
	tx: Executor,
	input: NewConversation,
): Promise<{ id: string }> {
	const ids = [...new Set(input.editionIds)];
	if (ids.length === 0)
		throw new Error("a conversation needs at least one book");
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
			maxPosition: input.scopes?.[editionId]?.maxPosition ?? null,
			scopeLabel: input.scopes?.[editionId]?.scopeLabel ?? null,
		})),
	);
	return row;
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
			scopeLabel: conversationEditions.scopeLabel,
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
			scopeLabel: conversationEditions.scopeLabel,
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
			guideContext: messages.guideContext,
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
	/** Chosen by the caller when the client already knows the message by this id. */
	id?: string;
	conversationId: string;
	role: "user" | "assistant";
	parts: Json[];
	citations?: CitationRecord[];
	finishReason?: string | null;
	model?: string | null;
	promptVersion?: string | null;
	error?: string | null;
	guideContext?: GuideContextEntry[] | null;
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
				id: m.id,
				conversationId: m.conversationId,
				seq: next,
				role: m.role,
				parts: m.parts,
				citations: m.citations ?? [],
				finishReason: m.finishReason ?? null,
				model: m.model ?? null,
				promptVersion: m.promptVersion ?? null,
				error: m.error ?? null,
				guideContext: m.guideContext ?? null,
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

/**
 * Resolves a scope against the edition's current reading units. Returns
 * undefined when a unit scope matches no current unit's end, meaning the
 * units changed since the reader chose. The label always comes from the
 * server-side unit.
 */
export async function resolveScope(
	db: Executor,
	editionId: string,
	scope: Scope,
): Promise<ResolvedScope | undefined> {
	if (scope.kind === "whole") return null;
	const units = await getReadingUnits(db, editionId);
	const unit = units.find((u) => u.endPosition === scope.endPosition);
	return unit
		? { maxPosition: unit.endPosition, scopeLabel: unit.label }
		: undefined;
}

/**
 * Starts a conversation about one ready book with the reader's chosen scope.
 * Returns null when the book does not exist or is not ready, and
 * `stale_scope` when the chosen unit is no longer one of the book's units.
 */
export async function createConversationForEdition(
	db: Database,
	editionId: string,
	scope: Scope,
): Promise<{ id: string } | { error: "stale_scope" } | null> {
	return db.transaction(async (tx) => {
		// Conflicts with the lock replaceEditionStructure takes, so units cannot change before the insert.
		const [edition] = await tx
			.select({ id: editions.id, status: editions.status })
			.from(editions)
			.where(eq(editions.id, editionId))
			.for("share");
		if (!edition || edition.status !== "ready") return null;
		const resolved = await resolveScope(tx, editionId, scope);
		if (resolved === undefined) return { error: "stale_scope" as const };
		return insertConversation(tx, {
			editionIds: [editionId],
			scopes: { [editionId]: resolved },
		});
	});
}

export type WidenResult =
	| { widened: true }
	| { widened: false; reason: "not_found" | "stale_scope" | "not_wider" };

/**
 * Moves a book's bound later, or removes it for whole book. Never narrows:
 * the condition is part of the UPDATE, so concurrent widens cannot move a
 * bound backwards. An equal or earlier unit, or any change to a whole-book
 * scope, leaves the scope untouched.
 */
export async function widenConversationScope(
	db: Executor,
	input: { conversationId: string; editionId: string; scope: Scope },
): Promise<WidenResult> {
	const resolved = await resolveScope(db, input.editionId, input.scope);
	if (resolved === undefined) return { widened: false, reason: "stale_scope" };
	const row = and(
		eq(conversationEditions.conversationId, input.conversationId),
		eq(conversationEditions.editionId, input.editionId),
	) as SQL;
	const rows = await db
		.update(conversationEditions)
		.set(resolved ?? { maxPosition: null, scopeLabel: null })
		.where(
			and(
				row,
				isNotNull(conversationEditions.maxPosition),
				resolved
					? lt(conversationEditions.maxPosition, resolved.maxPosition)
					: undefined,
			),
		)
		.returning({ editionId: conversationEditions.editionId });
	if (rows.length > 0) return { widened: true };
	const [exists] = await db
		.select({ one: sql`1` })
		.from(conversationEditions)
		.where(row);
	return { widened: false, reason: exists ? "not_wider" : "not_found" };
}

/**
 * Re-anchors every bound on an edition after a reparse (design D5). Runs
 * inside the reparse's transaction; labels are kept.
 */
export async function rebaseScopes(
	tx: Executor,
	editionId: string,
	rebase: (oldBound: number) => number,
): Promise<void> {
	const rows = await tx
		.selectDistinct({ maxPosition: conversationEditions.maxPosition })
		.from(conversationEditions)
		.where(
			and(
				eq(conversationEditions.editionId, editionId),
				isNotNull(conversationEditions.maxPosition),
			),
		);
	const moves = rows
		.map((r) => r.maxPosition as number)
		.map((old) => ({ old, next: rebase(old) }))
		.filter((m) => m.next !== m.old);
	if (moves.length === 0) return;
	// One statement, so a new bound equal to another old bound is not moved twice.
	const cases = sql.join(
		moves.map((m) => sql`when ${m.old}::int then ${m.next}::int`),
		sql` `,
	);
	await tx
		.update(conversationEditions)
		.set({
			maxPosition: sql`case ${conversationEditions.maxPosition} ${cases} end`,
		})
		.where(
			and(
				eq(conversationEditions.editionId, editionId),
				inArray(
					conversationEditions.maxPosition,
					moves.map((m) => m.old),
				),
			),
		);
}
