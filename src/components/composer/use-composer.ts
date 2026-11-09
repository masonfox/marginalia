import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { checkPassageRefFn } from "#/fns/conversations";
import { parseHighlight } from "#/lib/citations";
import {
	type ComposerDraft,
	clearComposerDraft,
	clearNewThreadDraft,
	type DraftComposer,
	type DraftSource,
	loadComposerDraft,
	loadNewThreadDraft,
	newThreadDraftId,
	restorableDraft,
	saveComposerDraft,
	saveNewThreadDraft,
	type ThreadAnchor,
	threadDraftId,
} from "#/lib/composer-draft";
import {
	type PassageRef,
	type PassageSnapshot,
	passageContextOf,
	passageRefSchema,
} from "#/lib/passage-ref";
import { type ReplyContext, replyContextOf } from "#/lib/reply-context";
import type { ConversationBook } from "#/modules/conversation";
import { blockedReason } from "./send-button";

/** The composer holds at most one attachment, so the kinds replace each other. */
export type Attachment =
	| { kind: "quote"; quote: ReplyContext }
	| { kind: "passage"; ref: PassageRef; snapshot: PassageSnapshot };

/** What shows in the attachment slot instead of the chip. */
export type Notice =
	| { kind: "checking" }
	| {
			kind: "out_of_scope";
			ref: PassageRef;
			editionId: string;
			unitLabel: string | null;
	  }
	| { kind: "invalid"; ref: PassageRef; message: string; reason?: string }
	| { kind: "quote_too_long" };

const INVALID_PASSAGE: Record<string, string> = {
	not_found: "That passage was not found.",
	removed: "That passage was removed in a newer parse of its book.",
	not_in_conversation: "That passage is from a book outside this conversation.",
	bad_range: "The selected part of that passage no longer matches its text.",
	too_long:
		"That passage is too long to attach. Select at most 4,000 characters.",
	no_conversation: "This conversation no longer exists.",
};

/** How long typing settles before the draft is saved. */
const SAVE_DELAY_MS = 300;

/** A sent message's attachment, in the composer's shape. */
export function attachmentOf(parts: unknown[]): Attachment | null {
	const quote = replyContextOf(parts);
	if (quote)
		return {
			kind: "quote",
			quote: { messageId: quote.messageId, text: quote.text },
		};
	const passage = passageContextOf(parts);
	if (passage) {
		const { version: _, ...snapshot } = passage;
		return {
			kind: "passage",
			ref: {
				locator: snapshot.locator,
				...(snapshot.range && { range: snapshot.range }),
			},
			snapshot,
		};
	}
	return null;
}

function toDraft(text: string, attachment: Attachment | null): ComposerDraft {
	return {
		text,
		attachment:
			attachment?.kind === "quote"
				? { kind: "quote", ...attachment.quote }
				: (attachment ?? null),
	};
}

/** The tab-session storage of one composer's draft. */
function draftStore(
	conversationId: string,
	target: DraftComposer,
	anchor: ThreadAnchor | undefined,
) {
	if (target.kind === "new-thread")
		return {
			id: newThreadDraftId(conversationId),
			load: (): ComposerDraft | null => loadNewThreadDraft(conversationId),
			save: (draft: ComposerDraft) => {
				// Without its anchor the new thread could not reopen; nothing to keep.
				if (anchor) saveNewThreadDraft(conversationId, { ...draft, anchor });
			},
			clear: () => clearNewThreadDraft(conversationId),
		};
	const id =
		target.kind === "thread"
			? threadDraftId(conversationId, target.threadId)
			: conversationId;
	return {
		id,
		load: () => loadComposerDraft(id),
		save: (draft: ComposerDraft) => {
			saveComposerDraft(id, draft);
		},
		clear: () => clearComposerDraft(id),
	};
}

const MAIN: DraftComposer = { kind: "main" };
const NO_HANDOFF: { ref?: string; hl?: string } = {};

/**
 * The draft, attachment, and notice of one composer of a conversation (the
 * main conversation, a thread, or the new thread): passage checks, the
 * passage-view handoff, and the tab-session copy of the draft.
 */
export function useComposer(
	conversationId: string,
	{
		target = MAIN,
		anchor,
		sources,
		books,
		aiEnabled,
		handoff = NO_HANDOFF,
		clearHandoff,
	}: {
		/** Which composer this is; the main conversation's by default. */
		target?: DraftComposer;
		/** The new thread's anchor, saved with its draft. */
		anchor?: ThreadAnchor;
		/** The conversation's saved assistant messages, which a restored quote may come from. */
		sources: ReadonlyMap<string, DraftSource>;
		books: ConversationBook[];
		aiEnabled: boolean;
		/** A passage reference handed over from the passage view, from the URL. */
		handoff?: { ref?: string; hl?: string };
		clearHandoff?: () => void;
	},
) {
	const store = draftStore(conversationId, target, anchor);
	const storeRef = useRef(store);
	storeRef.current = store;
	const [draft, setDraft] = useState("");
	const [attachment, setAttachment] = useState<Attachment | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	/** A restored passage is being checked again; only sending waits for it. */
	const [rechecking, setRechecking] = useState(false);
	/** The conversation the state above belongs to, once restored. */
	const [owner, setOwner] = useState<string | null>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	/** Drops check results that arrive after a newer check or a navigation. */
	const checkSeq = useRef(0);
	/** The attachment is a restored passage whose quiet recheck has not passed. */
	const unvalidated = useRef(false);
	const pending = useRef<{
		save: (draft: ComposerDraft) => void;
		draft: ComposerDraft;
	} | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	/** Just emptied by a send: the empty state is not saved back. */
	const cleared = useRef(false);
	/** The draft key restored last, to tell a new thread being created from a switch. */
	const restoredId = useRef<string | null>(null);

	const flush = () => {
		clearTimeout(timer.current);
		if (pending.current) pending.current.save(pending.current.draft);
		pending.current = null;
	};

	/**
	 * Cancels any check in flight, and drops a restored passage its recheck
	 * never confirmed, since nothing will check it now.
	 */
	const cancelCheck = () => {
		checkSeq.current++;
		setRechecking(false);
		if (unvalidated.current) {
			unvalidated.current = false;
			setAttachment(null);
		}
	};

	/** Checks a passage reference with the server; `quiet` keeps the chip in place meanwhile. */
	const check = async (ref: PassageRef, quiet: boolean) => {
		if (!quiet) cancelCheck();
		const seq = ++checkSeq.current;
		setRechecking(quiet);
		if (!quiet) setNotice({ kind: "checking" });
		const fail = (message: string, reason?: string) =>
			setNotice({ kind: "invalid", ref, message, reason });
		const settle = () => {
			unvalidated.current = false;
			setRechecking(false);
			if (quiet) setAttachment(null);
		};
		try {
			const result = await checkPassageRefFn({
				data: { conversationId, ref },
			});
			if (seq !== checkSeq.current) return;
			setRechecking(false);
			if (result.status === "ok") {
				unvalidated.current = false;
				setAttachment({ kind: "passage", ref, snapshot: result.snapshot });
				setNotice(null);
				if (!quiet) inputRef.current?.focus();
				return;
			}
			settle();
			if (result.status === "out_of_scope") {
				setNotice({
					kind: "out_of_scope",
					ref,
					editionId: result.editionId,
					unitLabel: result.unitLabel,
				});
			} else {
				const reason =
					result.status === "invalid" ? result.reason : result.status;
				fail(
					INVALID_PASSAGE[reason] ?? "That passage cannot be attached.",
					reason,
				);
			}
		} catch {
			if (seq !== checkSeq.current) return;
			settle();
			fail("Could not check the passage. Please try again.");
		}
	};

	/** Checks a passage reference and attaches it, or explains why not. */
	const attachPassage = (ref: PassageRef) => check(ref, false);

	// Restore this composer's saved draft. A layout effect, so it lands
	// before the first paint and before the handoff effect below.
	// biome-ignore lint/correctness/useExhaustiveDependencies: restores once per composer
	useLayoutEffect(() => {
		const previous = restoredId.current;
		restoredId.current = store.id;
		// The new thread was just created: this composer carries on as the
		// thread's, keeping anything typed since, under the thread's key.
		if (
			previous === newThreadDraftId(conversationId) &&
			target.kind === "thread"
		) {
			pending.current = null;
			clearTimeout(timer.current);
			clearNewThreadDraft(conversationId);
			setOwner(store.id);
			return;
		}
		flush();
		cancelCheck();
		cleared.current = false;
		const loaded = store.load();
		const saved = loaded && restorableDraft(loaded, target, sources);
		const restored = saved?.attachment;
		setDraft(saved?.text ?? "");
		setNotice(null);
		if (restored?.kind === "quote")
			setAttachment({
				kind: "quote",
				quote: { messageId: restored.messageId, text: restored.text },
			});
		else if (restored?.kind === "passage" && aiEnabled) {
			setAttachment(restored);
			unvalidated.current = true;
			void check(restored.ref, true);
		} else setAttachment(null);
		setOwner(store.id);
	}, [store.id]);

	// Save as the draft changes, once typing settles.
	// biome-ignore lint/correctness/useExhaustiveDependencies: flush reads refs only
	useEffect(() => {
		if (owner !== store.id) return;
		const next = toDraft(draft, attachment);
		if (cleared.current) {
			// The send already cleared the saved draft; keep it so until typing resumes.
			if (!next.text && !next.attachment) return;
			cleared.current = false;
		}
		pending.current = { save: storeRef.current.save, draft: next };
		clearTimeout(timer.current);
		timer.current = setTimeout(flush, SAVE_DELAY_MS);
	}, [owner, store.id, draft, attachment]);

	// Save before the page goes away or the composer unmounts.
	// biome-ignore lint/correctness/useExhaustiveDependencies: flush reads refs only
	useEffect(() => {
		window.addEventListener("pagehide", flush);
		return () => {
			window.removeEventListener("pagehide", flush);
			flush();
		};
	}, []);

	// A reference from the passage view: attach it once, replacing a restored
	// attachment, and drop it from the URL so a reload does not.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once per handed-over reference
	useEffect(() => {
		if (!handoff.ref) return;
		const ref = passageRefSchema.safeParse({
			locator: handoff.ref,
			range: parseHighlight(handoff.hl) ?? undefined,
		});
		clearHandoff?.();
		if (!aiEnabled) return;
		if (ref.success) void attachPassage(ref.data);
		else
			setNotice({
				kind: "invalid",
				ref: { locator: handoff.ref },
				message: INVALID_PASSAGE.not_found as string,
			});
	}, [handoff.ref, handoff.hl]);

	// After the reader widens the scope from the notice, try the passage again.
	const bounds = books.map((b) => `${b.editionId}:${b.maxPosition}`).join();
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-check only when a bound moves
	useEffect(() => {
		if (notice?.kind === "out_of_scope") void attachPassage(notice.ref);
	}, [bounds]);

	return {
		draft,
		setDraft,
		attachment,
		notice,
		inputRef,
		attachPassage,
		attachQuote(quote: ReplyContext) {
			cancelCheck();
			setNotice(null);
			setAttachment({ kind: "quote", quote });
			inputRef.current?.focus();
		},
		/** The over-limit message, leaving any attachment as it is. */
		rejectLongQuote() {
			setNotice({ kind: "quote_too_long" });
		},
		removeAttachment() {
			cancelCheck();
			setAttachment(null);
			inputRef.current?.focus();
		},
		dismissNotice() {
			// The long-quote notice may cover a quiet recheck, which must still
			// settle; any other check in flight is cancelled with its slot.
			if (!(notice?.kind === "quote_too_long" && rechecking)) cancelCheck();
			setNotice(null);
			inputRef.current?.focus();
		},
		/** Puts a failed message back, keeping anything the reader has typed since. */
		restore(text: string, restored: Attachment | null) {
			setDraft((current) => current || text);
			setAttachment((current) => current ?? restored);
			inputRef.current?.focus();
		},
		/** Empties the composer and its saved draft, after a submit. */
		clear() {
			cancelCheck();
			setDraft("");
			setAttachment(null);
			setNotice(null);
			pending.current = null;
			clearTimeout(timer.current);
			cleared.current = true;
			storeRef.current.clear();
		},
		blockedReason: blockedReason({
			draft,
			checking: rechecking || notice?.kind === "checking",
		}),
	};
}

export type ComposerState = ReturnType<typeof useComposer>;
