import { z } from "zod";
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
});
type StoredDraft = z.infer<typeof draftSchema>;
export type ComposerDraft = Omit<StoredDraft, "v">;
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

/** Saves a draft, or removes the saved one when there is nothing to keep. */
export function saveComposerDraft(
	conversationId: string,
	draft: ComposerDraft,
	storage = sessionStore(),
): void {
	if (!draft.text && !draft.attachment) {
		clearComposerDraft(conversationId, storage);
		return;
	}
	try {
		storage?.setItem(
			composerDraftKey(conversationId),
			JSON.stringify({ v: 1, ...draft } satisfies StoredDraft),
		);
	} catch {
		// Quota or private mode: the draft just is not restored.
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
