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
