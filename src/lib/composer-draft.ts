import { z } from "zod";
import { MAX_CONVERSATION_BOOKS } from "./conversation-books";
import { passageRefSchema, passageSnapshotSchema } from "./passage-ref";
import { replyContextSchema } from "./reply-context";

/** The longest message the composer accepts. */
export const MESSAGE_LIMIT = 8000;

const draftSchema = z.object({
	v: z.literal(1),
	text: z.string().max(MESSAGE_LIMIT),
	attachment: z
		.discriminatedUnion("kind", [
			replyContextSchema.extend({ kind: z.literal("quote") }),
			z.object({
				kind: z.literal("passage"),
				/** The reference the reader attached, checked again on restore. */
				ref: passageRefSchema,
				/** What the last successful check returned. */
				snapshot: passageSnapshotSchema,
			}),
		])
		.nullable(),
	/**
	 * The books chosen in a composer that starts a conversation, in the order
	 * they were added; absent when they are the ones it starts with.
	 */
	books: z
		.array(z.object({ editionId: z.string(), title: z.string() }))
		.max(MAX_CONVERSATION_BOOKS)
		.optional(),
});
type StoredDraft = z.infer<typeof draftSchema>;
export type ComposerDraft = Omit<StoredDraft, "v">;
/** A book chosen in a new conversation's composer draft. */
export type DraftBook = NonNullable<ComposerDraft["books"]>[number];
export type DraftAttachment = NonNullable<ComposerDraft["attachment"]>;

export const composerDraftKey = (conversationId: string) =>
	`marginalia:composer:${conversationId}`;

/** The tab's session storage, or null where it is missing or blocked. */
function sessionStore(): Storage | null {
	try {
		return globalThis.sessionStorage ?? null;
	} catch {
		return null;
	}
}

/** A conversation's saved draft; anything unreadable counts as none. */
export function loadComposerDraft(
	conversationId: string,
	storage = sessionStore(),
): ComposerDraft | null {
	try {
		const raw = storage?.getItem(composerDraftKey(conversationId));
		if (!raw) return null;
		const parsed = draftSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) return null;
		const { v: _, ...draft } = parsed.data;
		return draft;
	} catch {
		return null;
	}
}

/**
 * Saves a draft, or removes the saved one when there is nothing to keep.
 * Returns whether a non-empty draft was stored. Most callers can ignore the
 * result, since a lost draft is just not restored.
 */
export function saveComposerDraft(
	conversationId: string,
	draft: ComposerDraft,
	storage = sessionStore(),
): boolean {
	if (!draft.text && !draft.attachment && !draft.books?.length) {
		clearComposerDraft(conversationId, storage);
		return true;
	}
	if (!storage) return false;
	try {
		storage.setItem(
			composerDraftKey(conversationId),
			JSON.stringify({ v: 1, ...draft } satisfies StoredDraft),
		);
		return true;
	} catch {
		// Quota or private mode: the draft is not kept.
		return false;
	}
}

export function clearComposerDraft(
	conversationId: string,
	storage = sessionStore(),
): void {
	try {
		storage?.removeItem(composerDraftKey(conversationId));
	} catch {
		// Nothing to clear without storage.
	}
}

/** The draft ID of an existing thread's composer in a conversation. */
export const threadDraftId = (conversationId: string, threadId: string) =>
	`${conversationId}:thread:${threadId}`;

/** The draft ID of a conversation's single new thread that has not been sent. */
export const newThreadDraftId = (conversationId: string) =>
	`${conversationId}:thread:new`;

/** Where a new thread starts: a main-conversation assistant response and the text selected in it. */
const threadAnchorSchema = z.object({
	anchorMessageId: z.uuid(),
	quote: replyContextSchema.shape.text,
});
export type ThreadAnchor = z.infer<typeof threadAnchorSchema>;

/**
 * The new-thread draft is the only shape with an anchor, so only it moves to
 * format version 2. Every other draft stays version 1.
 */
const newThreadDraftSchema = draftSchema.extend({
	v: z.literal(2),
	anchor: threadAnchorSchema,
});
export type NewThreadDraft = ComposerDraft & { anchor: ThreadAnchor };

/** A conversation's new-thread draft; anything unreadable counts as none. */
export function loadNewThreadDraft(
	conversationId: string,
	storage = sessionStore(),
): NewThreadDraft | null {
	try {
		const raw = storage?.getItem(
			composerDraftKey(newThreadDraftId(conversationId)),
		);
		if (!raw) return null;
		const parsed = newThreadDraftSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) return null;
		const { v: _, ...draft } = parsed.data;
		return draft;
	} catch {
		return null;
	}
}

/**
 * Saves the new-thread draft, replacing any earlier one in the conversation.
 * It is kept even with no text, since the anchor alone reopens the new thread.
 * Returns whether it was stored.
 */
export function saveNewThreadDraft(
	conversationId: string,
	draft: NewThreadDraft,
	storage = sessionStore(),
): boolean {
	if (!storage) return false;
	try {
		storage.setItem(
			composerDraftKey(newThreadDraftId(conversationId)),
			JSON.stringify({ v: 2, ...draft } satisfies z.input<
				typeof newThreadDraftSchema
			>),
		);
		return true;
	} catch {
		// Quota or private mode: the draft is not kept.
		return false;
	}
}

export function clearNewThreadDraft(
	conversationId: string,
	storage = sessionStore(),
): void {
	clearComposerDraft(newThreadDraftId(conversationId), storage);
}

/** Clears every draft of a conversation: its main composer, its threads, and its new thread. */
export function clearConversationDrafts(
	conversationId: string,
	storage = sessionStore(),
): void {
	clearComposerDraft(conversationId, storage);
	try {
		if (!storage) return;
		const prefix = composerDraftKey(threadDraftId(conversationId, ""));
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (key?.startsWith(prefix)) keys.push(key);
		}
		for (const key of keys) storage.removeItem(key);
	} catch {
		// Nothing to clear without storage.
	}
}

/** The composer a draft belongs to. */
export type DraftComposer =
	| { kind: "main" }
	| { kind: "thread"; threadId: string }
	| { kind: "new-thread" };

/** A saved assistant message in the conversation and its thread (null for the main conversation). */
export interface DraftSource {
	threadId: string | null;
}

/**
 * Whether a quote from `source` may be restored into `composer`. The main
 * composer takes any assistant message in the conversation, including one
 * brought from a thread. A thread composer takes only its own thread's. A new
 * thread has no messages of its own yet, so it takes none.
 */
export function isQuoteSourceValid(
	composer: DraftComposer,
	source: DraftSource | undefined,
): boolean {
	if (!source) return false;
	if (composer.kind === "main") return true;
	if (composer.kind === "thread") return source.threadId === composer.threadId;
	return false;
}

/**
 * A loaded draft ready for its composer. A quote whose source is gone, or is
 * not valid for that composer, is dropped, and the text is kept.
 */
export function restorableDraft<D extends ComposerDraft>(
	draft: D,
	composer: DraftComposer,
	/** The conversation's saved assistant messages, by ID. */
	sources: ReadonlyMap<string, DraftSource>,
): D {
	const attachment = draft.attachment;
	if (
		attachment?.kind === "quote" &&
		!isQuoteSourceValid(composer, sources.get(attachment.messageId))
	)
		return { ...draft, attachment: null };
	return draft;
}

/**
 * A loaded new-thread draft ready to reopen, or null when its anchor response
 * is no longer a main-conversation assistant message in the conversation. The
 * new thread is then not reopened.
 */
export function restorableNewThreadDraft(
	draft: NewThreadDraft | null,
	sources: ReadonlyMap<string, DraftSource>,
): NewThreadDraft | null {
	if (!draft) return null;
	const anchor = sources.get(draft.anchor.anchorMessageId);
	if (!anchor || anchor.threadId !== null) return null;
	return restorableDraft(draft, { kind: "new-thread" }, sources);
}

/** The draft key of a book page's composer, before any conversation exists. */
export const bookDraftId = (editionId: string) => `book:${editionId}`;

/** The draft key of the header's New conversation composer, which has no book of its own. */
export const newConversationDraftId = "new-conversation";

declare module "@tanstack/react-router" {
	interface HistoryState {
		/**
		 * Set when the book page created a conversation and saved its first
		 * message as the draft: the conversation sends it once, then drops this.
		 */
		autoSend?: boolean;
	}
}
