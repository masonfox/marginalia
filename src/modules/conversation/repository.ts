import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	notExists,
	or,
	type SQL,
	type SQLWrapper,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import { MAX_CONVERSATION_BOOKS } from "#/lib/conversation-books";
import {
	CONVERSATIONS_PAGE_SIZE,
	type ConversationCursor,
	decodeConversationCursor,
	encodeConversationCursor,
} from "#/lib/conversation-cursor";
import { previewText } from "#/lib/preview-text";
import { REPLY_CONTEXT_LIMIT, replyContextOf } from "#/lib/reply-context";
import { getReadingUnits } from "#/modules/catalog";
import { editions } from "#/modules/library";
import type { AiSelection } from "#/server/config";
import type { Database, Executor } from "#/server/db";
import {
	type CitationRecord,
	conversationEditions,
	conversations,
	conversationThreads,
	type GuideContextEntry,
	type Json,
	messages,
	type NamingState,
} from "./schema";

export const DEFAULT_TITLE = "New conversation";

/** Characters of message text fetched for a list preview. */
const PREVIEW_SOURCE_CHARS = 600;

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
	/** Whether the edition has a cover image at `/api/covers/{editionId}`. */
	hasCover: boolean;
}

/** How far the reader has read in a book: a reading unit, by its end position, or the whole book. */
export type Scope = { kind: "whole" } | { kind: "unit"; endPosition: number };

export const scopeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("whole") }),
	z.object({ kind: z.literal("unit"), endPosition: z.number().int() }),
]);

export { MAX_CONVERSATION_BOOKS };

/** A new conversation's books with their scopes: 1 to MAX_CONVERSATION_BOOKS, distinct, in the reader's order. */
export const newConversationBooksSchema = z
	.array(z.object({ editionId: z.uuid(), scope: scopeSchema }))
	.min(1)
	.max(MAX_CONVERSATION_BOOKS)
	.refine(
		(books) => new Set(books.map((b) => b.editionId)).size === books.length,
		"Books must be distinct",
	);

/** A stored bound: null for whole book. */
export type ResolvedScope = { maxPosition: number; scopeLabel: string } | null;

export interface NamingMetadata {
	state: NamingState;
	locked: boolean;
	expiresAt: Date | string | null;
	deadline: Date | string | null;
	revision: number;
}
export interface ConversationSummary {
	naming?: NamingMetadata;
	id: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	/** Scope of the listed book in this conversation; null means whole book. */
	scopeLabel: string | null;
	/** Plain text of the latest message that has text; null when none does. */
	preview: string | null;
}

export interface StoredMessage {
	id: string;
	/** The side thread holding the message; null for the main conversation. */
	threadId: string | null;
	seq: number;
	role: "user" | "assistant";
	parts: Json[];
	citations: CitationRecord[];
	finishReason: string | null;
	/** Provider and model of an assistant reply; null for user messages and older replies. */
	provider: string | null;
	model: string | null;
	promptVersion: string | null;
	error: string | null;
	/** The book maps an assistant reply was generated with; null when none, and for older replies. */
	guideContext: GuideContextEntry[] | null;
	createdAt: Date;
}

export interface ConversationDetail {
	naming?: NamingMetadata;
	id: string;
	title: string;
	createdAt: Date;
	updatedAt: Date;
	/** The conversation's own model; null when it follows the chat default. */
	model: AiSelection | null;
	books: ConversationBook[];
	/** Main-conversation messages only; a thread's messages load with the thread. */
	messages: StoredMessage[];
	/** The conversation's side threads, oldest first. */
	threads: ThreadSummary[];
	/**
	 * For assistant-response quotes in main messages whose source reply is in a
	 * thread (Bring to main): the source message id mapped to its thread id.
	 */
	quoteSourceThreads: Record<string, string>;
	/**
	 * Every saved, non-errored assistant reply inside a thread, mapped to its
	 * thread id: the replies a pending Bring to main quote may come from.
	 */
	threadReplies: Record<string, string>;
}

/** A side thread as the conversation view lists it. */
export interface ThreadSummary {
	id: string;
	/** The main-conversation assistant reply the thread is anchored to. */
	anchorMessageId: string;
	/** The selected reply text the thread is about. */
	anchorQuote: string;
	createdAt: Date;
	/** When a message was last appended to the thread. */
	updatedAt: Date;
	messageCount: number;
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
	/** The conversation's own model; omit to follow the chat default. */
	model?: AiSelection | null;
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
		.values({
			title: input.title?.trim() || DEFAULT_TITLE,
			namingState: "eligible",
			aiProvider: input.model?.provider ?? null,
			aiModel: input.model?.model ?? null,
		})
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

/**
 * The columns every conversation list shares: the message count and the
 * source of the preview. Join `latest` laterally (`leftJoinLateral(latest,
 * sql\`true\`)`) to a query over `conversations`, select `columns`, and pass
 * each row's `previewSource` through `toPreview`.
 */
function listColumns(db: Executor) {
	// The latest message with a non-empty text part, walking the (conversation_id, seq) index backwards.
	const latest = db
		.select({ parts: messages.parts })
		.from(messages)
		.where(
			and(
				eq(messages.conversationId, conversations.id),
				// Previews show the main conversation; thread activity only bumps updatedAt.
				isNull(messages.threadId),
				sql`exists (select 1 from json_array_elements(${messages.parts}) as p where p->>'type' = 'text' and p->>'text' ~ '\\S')`,
			),
		)
		.orderBy(desc(messages.seq))
		.limit(1)
		.as("latest_text");
	return {
		latest,
		columns: {
			id: conversations.id,
			title: conversations.title,
			naming: sql<NamingMetadata>`json_build_object('state', ${conversations.namingState}, 'locked', ${conversations.titleLocked}, 'expiresAt', ${conversations.namingExpiresAt}, 'deadline', ${conversations.namingDeadline}, 'revision', ${conversations.namingRevision})`,
			createdAt: conversations.createdAt,
			updatedAt: conversations.updatedAt,
			previewSource: sql<string | null>`(
				select left(string_agg(e.p->>'text', E'\\n\\n' order by e.o), ${PREVIEW_SOURCE_CHARS}::int)
				from json_array_elements(${latest.parts}) with ordinality as e(p, o)
				where e.p->>'type' = 'text'
			)`,
		},
	};
}

/** A list row's preview from its `previewSource`. */
const toPreview = (source: string | null): string | null =>
	(source && previewText(source)) || null;

/** Conversations that include the edition, most recently active first. */
export async function listConversationsForEdition(
	db: Executor,
	editionId: string,
): Promise<ConversationSummary[]> {
	const { latest, columns } = listColumns(db);
	const rows = await db
		.select({ ...columns, scopeLabel: conversationEditions.scopeLabel })
		.from(conversations)
		.innerJoin(
			conversationEditions,
			eq(conversationEditions.conversationId, conversations.id),
		)
		.leftJoinLateral(latest, sql`true`)
		.where(eq(conversationEditions.editionId, editionId))
		.orderBy(desc(conversations.updatedAt), desc(conversations.createdAt));
	return rows.map(({ previewSource, ...row }) => ({
		...row,
		preview: toPreview(previewSource),
	}));
}

/** A book as named in a list of conversations across books. */
export interface ConversationListBook {
	editionId: string;
	title: string;
	/** Whether the edition has a cover image at `/api/covers/<editionId>`. */
	hasCover: boolean;
	/** The reading unit the conversation is scoped through; null means whole book. */
	scopeLabel: string | null;
}

export interface RecentConversation
	extends Omit<ConversationSummary, "scopeLabel"> {
	/** The conversation's books in their stored order. */
	books: ConversationListBook[];
}

export interface RecentConversationPage {
	items: RecentConversation[];
	/** Opaque; pass back as `cursor` for the next page. Null after the last page. */
	nextCursor: string | null;
}

export class InvalidConversationCursorError extends Error {
	constructor() {
		super("Invalid conversations cursor");
		this.name = "InvalidConversationCursorError";
	}
}

/** A timestamptz at full (microsecond) precision, which a JS Date would lose. */
const timestampKeySql = (column: SQLWrapper) =>
	sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * One page of every conversation, whatever its books, most recently active
 * first, then most recently created. Paging is keyset on (updated_at,
 * created_at, id), so a conversation that becomes active after it was listed
 * moves above the cursor and is not returned again.
 */
export async function listRecentConversations(
	db: Executor,
	{
		cursor,
		limit = CONVERSATIONS_PAGE_SIZE,
	}: { cursor?: string; limit?: number } = {},
): Promise<RecentConversationPage> {
	let after: ConversationCursor | null = null;
	if (cursor !== undefined) {
		after = decodeConversationCursor(cursor);
		if (!after) throw new InvalidConversationCursorError();
	}
	const pageSize = Math.max(
		1,
		Math.min(Math.trunc(limit), CONVERSATIONS_PAGE_SIZE),
	);
	const { latest, columns } = listColumns(db);
	const rows = await db
		.select({
			...columns,
			books: sql<ConversationListBook[]>`coalesce((
				select json_agg(json_build_object(
					'editionId', ${editions.id},
					'title', ${editions.title},
					'hasCover', ${editions.coverPath} is not null,
					'scopeLabel', ${conversationEditions.scopeLabel}
				) order by ${conversationEditions.ordinal})
				from ${conversationEditions}
				inner join ${editions} on ${editions.id} = ${conversationEditions.editionId}
				where ${conversationEditions.conversationId} = ${conversations.id}
			), '[]'::json)`,
			updatedKey: timestampKeySql(conversations.updatedAt),
			createdKey: timestampKeySql(conversations.createdAt),
		})
		.from(conversations)
		.leftJoinLateral(latest, sql`true`)
		.where(
			after
				? sql`(${conversations.updatedAt}, ${conversations.createdAt}, ${conversations.id}) < (${after.u}::timestamptz, ${after.c}::timestamptz, ${after.i}::uuid)`
				: undefined,
		)
		.orderBy(
			desc(conversations.updatedAt),
			desc(conversations.createdAt),
			desc(conversations.id),
		)
		.limit(pageSize + 1);
	const page = rows.slice(0, pageSize);
	const last = page.at(-1);
	return {
		items: page.map(
			({ previewSource, updatedKey: _u, createdKey: _c, ...row }) => ({
				...row,
				preview: toPreview(previewSource),
			}),
		),
		nextCursor:
			rows.length > pageSize && last
				? encodeConversationCursor({
						u: last.updatedKey,
						c: last.createdKey,
						i: last.id,
					})
				: null,
	};
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
			hasCover: sql<boolean>`${editions.coverPath} is not null`,
		})
		.from(conversationEditions)
		.innerJoin(editions, eq(editions.id, conversationEditions.editionId))
		.where(eq(conversationEditions.conversationId, conversationId))
		.orderBy(asc(conversationEditions.ordinal));
}

/**
 * A conversation's messages in order: the main conversation's by default, or
 * one thread's own messages when `threadId` is given.
 */
export async function getMessages(
	db: Executor,
	conversationId: string,
	{ threadId = null }: { threadId?: string | null } = {},
): Promise<StoredMessage[]> {
	return db
		.select({
			id: messages.id,
			threadId: messages.threadId,
			seq: messages.seq,
			role: messages.role,
			parts: messages.parts,
			citations: messages.citations,
			finishReason: messages.finishReason,
			provider: messages.provider,
			model: messages.model,
			promptVersion: messages.promptVersion,
			error: messages.error,
			guideContext: messages.guideContext,
			createdAt: messages.createdAt,
		})
		.from(messages)
		.where(
			and(
				eq(messages.conversationId, conversationId),
				threadId === null
					? isNull(messages.threadId)
					: eq(messages.threadId, threadId),
			),
		)
		.orderBy(asc(messages.seq));
}

const threadSummaryColumns = {
	id: conversationThreads.id,
	anchorMessageId: conversationThreads.anchorMessageId,
	anchorQuote: conversationThreads.anchorQuote,
	createdAt: conversationThreads.createdAt,
	updatedAt: conversationThreads.updatedAt,
	// Qualified by hand: drizzle leaves columns unqualified in a one-table select.
	messageCount: sql<number>`(select count(*)::int from "messages" as tm where tm."thread_id" = "conversation_threads"."id")`,
};

/** A conversation's side threads, oldest first. */
export async function listThreads(
	db: Executor,
	conversationId: string,
): Promise<ThreadSummary[]> {
	return db
		.select(threadSummaryColumns)
		.from(conversationThreads)
		.where(eq(conversationThreads.conversationId, conversationId))
		.orderBy(asc(conversationThreads.createdAt), asc(conversationThreads.id));
}

/** One thread of a conversation, or null when the conversation has no such thread. */
export async function getThread(
	db: Executor,
	conversationId: string,
	threadId: string,
): Promise<ThreadSummary | null> {
	const [row] = await db
		.select(threadSummaryColumns)
		.from(conversationThreads)
		.where(
			and(
				eq(conversationThreads.conversationId, conversationId),
				eq(conversationThreads.id, threadId),
			),
		);
	return row ?? null;
}

export interface ThreadDetail {
	thread: ThreadSummary;
	/** The thread's own messages in order (not the main-conversation prefix). */
	messages: StoredMessage[];
}

/** A thread with its own messages, or null when the conversation has no such thread. */
export async function getThreadMessages(
	db: Executor,
	conversationId: string,
	threadId: string,
): Promise<ThreadDetail | null> {
	const [thread, msgs] = await Promise.all([
		getThread(db, conversationId, threadId),
		getMessages(db, conversationId, { threadId }),
	]);
	return thread ? { thread, messages: msgs } : null;
}

/** Quoted source replies of main messages that live in a thread, by source message id. */
async function quoteSourceThreadsOf(
	db: Executor,
	conversationId: string,
	main: StoredMessage[],
): Promise<Record<string, string>> {
	const ids = [
		...new Set(
			main.flatMap((m) => {
				const quote = m.role === "user" ? replyContextOf(m.parts) : undefined;
				return quote ? [quote.messageId] : [];
			}),
		),
	];
	if (ids.length === 0) return {};
	const rows = await db
		.select({ id: messages.id, threadId: messages.threadId })
		.from(messages)
		.where(
			and(
				eq(messages.conversationId, conversationId),
				inArray(messages.id, ids),
				isNotNull(messages.threadId),
			),
		);
	return Object.fromEntries(rows.map((r) => [r.id, r.threadId as string]));
}

/** Saved, non-errored assistant replies inside the conversation's threads, by message id. */
async function threadRepliesOf(
	db: Executor,
	conversationId: string,
): Promise<Record<string, string>> {
	const rows = await db
		.select({ id: messages.id, threadId: messages.threadId })
		.from(messages)
		.where(
			and(
				eq(messages.conversationId, conversationId),
				isNotNull(messages.threadId),
				eq(messages.role, "assistant"),
				or(isNull(messages.finishReason), ne(messages.finishReason, "error")),
			),
		);
	return Object.fromEntries(rows.map((r) => [r.id, r.threadId as string]));
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
	const [books, msgs, threads, threadReplies] = await Promise.all([
		getConversationBooks(db, conversationId),
		getMessages(db, conversationId),
		listThreads(db, conversationId),
		threadRepliesOf(db, conversationId),
	]);
	return {
		id: row.id,
		title: row.title,
		naming: {
			state: row.namingState,
			locked: row.titleLocked,
			expiresAt: row.namingExpiresAt,
			deadline: row.namingDeadline,
			revision: row.namingRevision,
		},
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		model:
			row.aiProvider && row.aiModel
				? { provider: row.aiProvider, model: row.aiModel }
				: null,
		books,
		messages: msgs,
		threads,
		quoteSourceThreads: await quoteSourceThreadsOf(db, conversationId, msgs),
		threadReplies,
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
		.set({
			title: trimmed,
			titleLocked: true,
			namingState: sql`case when ${conversations.namingState} in ('eligible', 'pending', 'running') then 'skipped' else ${conversations.namingState} end`,
			namingRevision: sql`${conversations.namingRevision} + 1`,
		})
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

/**
 * Sets the conversation's own model, or clears it with null so the chat
 * default applies. False when the conversation does not exist.
 */
export async function updateConversationModel(
	db: Executor,
	conversationId: string,
	model: AiSelection | null,
): Promise<boolean> {
	const rows = await db
		.update(conversations)
		.set({ aiProvider: model?.provider ?? null, aiModel: model?.model ?? null })
		.where(eq(conversations.id, conversationId))
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
export async function pruneEmptyConversations(
	db: Executor,
	cancel?: (id: string) => Promise<unknown>,
): Promise<number> {
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
	if (cancel)
		await Promise.all(rows.map((row) => cancel(row.id).catch(() => undefined)));
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
	provider?: string | null;
	model?: string | null;
	promptVersion?: string | null;
	error?: string | null;
	guideContext?: GuideContextEntry[] | null;
	/** Present only for a new user turn, never a retry. */
	namingSelection?: AiSelection;
	/** The side thread to append to; omit or null for the main conversation. */
	threadId?: string | null;
}

export interface AppendedMessage {
	id: string;
	seq: number;
	namingPending: boolean;
}

/**
 * Appends a message with the next sequence number and bumps the
 * conversation's activity time (and the thread's, for a thread message).
 */
export async function appendMessage(
	db: Database,
	m: NewMessage,
): Promise<AppendedMessage> {
	return db.transaction(async (tx) => {
		const parent = await lockConversation(tx, m.conversationId);
		if (!parent) throw new Error("conversation not found");
		if (m.threadId) {
			const [thread] = await tx
				.select({ id: conversationThreads.id })
				.from(conversationThreads)
				.where(
					and(
						eq(conversationThreads.id, m.threadId),
						eq(conversationThreads.conversationId, m.conversationId),
					),
				);
			if (!thread) throw new Error("thread not found");
		}
		return insertMessage(tx, parent, m);
	});
}

export type NewThreadResult =
	| ({ status: "ok"; threadId: string } & AppendedMessage)
	| { status: "invalid_anchor" };

/**
 * Starts a side thread with its first message, in one transaction. The anchor
 * must be a stored, non-errored assistant reply of the conversation's main
 * conversation, and the quote 1 to 2,000 characters after trimming;
 * otherwise nothing is stored and the result is `invalid_anchor`.
 */
export async function createThreadWithMessage(
	db: Database,
	input: {
		conversationId: string;
		anchorMessageId: string;
		quote: string;
		message: Omit<NewMessage, "conversationId" | "threadId">;
	},
): Promise<NewThreadResult> {
	const quote = input.quote.trim();
	if (quote.length === 0 || quote.length > REPLY_CONTEXT_LIMIT)
		return { status: "invalid_anchor" };
	return db.transaction(async (tx) => {
		const parent = await lockConversation(tx, input.conversationId);
		if (!parent) throw new Error("conversation not found");
		const [anchor] = await tx
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(
					eq(messages.id, input.anchorMessageId),
					eq(messages.conversationId, input.conversationId),
					eq(messages.role, "assistant"),
					isNull(messages.threadId),
					// A failed reply can be retried, which deletes it.
					or(isNull(messages.finishReason), ne(messages.finishReason, "error")),
				),
			);
		if (!anchor) return { status: "invalid_anchor" as const };
		const [thread] = await tx
			.insert(conversationThreads)
			.values({
				conversationId: input.conversationId,
				anchorMessageId: anchor.id,
				anchorQuote: quote,
			})
			.returning({ id: conversationThreads.id });
		if (!thread) throw new Error("could not create thread");
		const saved = await insertMessage(tx, parent, {
			...input.message,
			conversationId: input.conversationId,
			threadId: thread.id,
		});
		return { status: "ok" as const, threadId: thread.id, ...saved };
	});
}

/** Locks the conversation row, so appends serialize and `seq` stays gap-free. */
async function lockConversation(tx: Executor, conversationId: string) {
	const [parent] = await tx
		.select()
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.for("update");
	return parent;
}

/** appendMessage's writes, under the conversation lock the caller holds. */
async function insertMessage(
	tx: Executor,
	parent: typeof conversations.$inferSelect,
	m: NewMessage,
): Promise<AppendedMessage> {
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
			threadId: m.threadId ?? null,
			seq: next,
			role: m.role,
			parts: m.parts,
			citations: m.citations ?? [],
			finishReason: m.finishReason ?? null,
			provider: m.provider ?? null,
			model: m.model ?? null,
			promptVersion: m.promptVersion ?? null,
			error: m.error ?? null,
			guideContext: m.guideContext ?? null,
		})
		.returning({ id: messages.id, seq: messages.seq });
	if (!row) throw new Error("could not append message");
	if (next === 1 && m.role === "user") {
		const text = m.parts
			.flatMap((p) =>
				p &&
				typeof p === "object" &&
				!Array.isArray(p) &&
				p.type === "text" &&
				typeof p.text === "string"
					? [p.text]
					: [],
			)
			.join("\n");
		await setProvisionalTitle(tx, m.conversationId, text);
		if (parent.namingState === "eligible" && m.namingSelection) {
			await tx
				.update(conversations)
				.set({
					namingState: parent.titleLocked ? "skipped" : "pending",
					namingMessageId: row.id,
					namingProvider: m.namingSelection.provider,
					namingModel: m.namingSelection.model,
					namingExpiresAt: sql`clock_timestamp() + interval '5 minutes'`,
					namingRevision: sql`${conversations.namingRevision} + 1`,
				})
				.where(eq(conversations.id, m.conversationId));
		}
	}
	const now = new Date();
	await tx
		.update(conversations)
		.set({ updatedAt: now })
		.where(eq(conversations.id, m.conversationId));
	if (m.threadId)
		await tx
			.update(conversationThreads)
			.set({ updatedAt: now })
			.where(eq(conversationThreads.id, m.threadId));
	return {
		...row,
		namingPending:
			next === 1 &&
			m.role === "user" &&
			parent.namingState === "eligible" &&
			!parent.titleLocked &&
			!!m.namingSelection,
	};
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

/** A book a new conversation is about, with the reader's chosen scope for it. */
export interface NewConversationBook {
	editionId: string;
	scope: Scope;
}

export type CreateConversationResult =
	| { id: string }
	| { error: "not_ready" | "stale_scope"; editionId: string };

/**
 * Starts a conversation about one or more distinct ready books, each with the
 * reader's chosen scope, in the given order, and optionally its own model
 * (checked by the caller). All or nothing: returns `not_ready` for the first
 * book, in the given order, that is missing or not ready, and `stale_scope`
 * for the first whose chosen unit is no longer one of its units.
 */
export async function createConversationForEditions(
	db: Database,
	books: NewConversationBook[],
	model?: AiSelection,
): Promise<CreateConversationResult> {
	const ids = books.map((b) => b.editionId);
	if (ids.length === 0)
		throw new Error("a conversation needs at least one book");
	if (new Set(ids).size !== ids.length)
		throw new Error("a conversation's books must be distinct");
	return db.transaction(async (tx) => {
		// Conflicts with the lock replaceEditionStructure takes, so units cannot
		// change before the insert. Locking in id order keeps two creations, or a
		// creation and a reparse, over the same books from deadlocking.
		const rows = await tx
			.select({ id: editions.id, status: editions.status })
			.from(editions)
			.where(inArray(editions.id, ids))
			.orderBy(asc(editions.id))
			.for("share");
		const ready = new Set(
			rows.filter((r) => r.status === "ready").map((r) => r.id),
		);
		const missing = ids.find((id) => !ready.has(id));
		if (missing !== undefined)
			return { error: "not_ready" as const, editionId: missing };
		const scopes: Record<string, ResolvedScope> = {};
		for (const { editionId, scope } of books) {
			const resolved = await resolveScope(tx, editionId, scope);
			if (resolved === undefined)
				return { error: "stale_scope" as const, editionId };
			scopes[editionId] = resolved;
		}
		return insertConversation(tx, { editionIds: ids, scopes, model });
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

/**
 * Re-anchors the bounds replies recorded for an edition's maps after a
 * reparse, in every conversation whatever its current scope, so a guide
 * step read later stays within the recorded scope. Runs inside the reparse's
 * transaction; labels, fingerprints and other books' entries are kept.
 */
export async function rebaseGuideContexts(
	tx: Executor,
	editionId: string,
	rebase: (oldBound: number) => number,
): Promise<void> {
	// Reparses of different books can share a reply; lock in id order so each
	// reads the other's committed entries instead of overwriting them.
	const rows = await tx
		.select({ id: messages.id, guideContext: messages.guideContext })
		.from(messages)
		.where(
			sql`${messages.guideContext} @> ${JSON.stringify([{ editionId }])}::jsonb`,
		)
		.orderBy(messages.id)
		.for("update");
	for (const row of rows) {
		const entries = row.guideContext ?? [];
		let moved = false;
		const next = entries.map((entry) => {
			if (entry.editionId !== editionId || entry.maxPosition === null)
				return entry;
			const maxPosition = rebase(entry.maxPosition);
			if (maxPosition === entry.maxPosition) return entry;
			moved = true;
			return { ...entry, maxPosition };
		});
		if (moved)
			await tx
				.update(messages)
				.set({ guideContext: next })
				.where(eq(messages.id, row.id));
	}
}
