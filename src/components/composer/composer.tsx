import { useEffect, useState } from "react";
import { MESSAGE_LIMIT } from "#/lib/composer-draft";
import {
	attachmentKey,
	parsePassageLink,
	passageContextPart,
} from "#/lib/passage-ref";
import { replyContextPart } from "#/lib/reply-context";
import type { ConversationBook } from "#/modules/conversation";
import { AttachmentChip } from "./attachment-chip";
import { AutogrowTextarea } from "./autogrow-textarea";
import { ComposerNotice } from "./composer-notice";
import { SendButton } from "./send-button";
import type { Attachment, ComposerState } from "./use-composer";

/** The remaining-character count appears from here on. */
const COUNTER_FROM = 7200;

/** Whether the primary input is touch, where Enter inserts a newline. */
function useCoarsePointer() {
	const [coarse, setCoarse] = useState(false);
	useEffect(() => {
		const query = window.matchMedia("(pointer: coarse)");
		setCoarse(query.matches);
		const change = () => setCoarse(query.matches);
		query.addEventListener("change", change);
		return () => query.removeEventListener("change", change);
	}, []);
	return coarse;
}

/** Identifies an attachment, so a new one gets a fresh, collapsed chip. */
function keyOf(attachment: Attachment) {
	return attachmentKey([
		attachment.kind === "quote"
			? replyContextPart(attachment.quote)
			: passageContextPart(attachment.snapshot),
	]);
}

/**
 * The message composer: a card with the attachment slot, an autogrowing
 * input, and the Send/Stop control.
 */
export function Composer({
	composer,
	conversationId,
	books,
	busy,
	onSend,
	onStop,
}: {
	composer: ComposerState;
	conversationId: string;
	books: ConversationBook[];
	busy: boolean;
	onSend: () => void;
	onStop: () => void;
}) {
	const coarse = useCoarsePointer();
	const { draft, attachment, notice, blockedReason } = composer;
	const remaining = MESSAGE_LIMIT - draft.length;
	return (
		<>
			<form
				className="rounded-2xl border bg-card p-2 shadow-md focus-within:border-ring/60"
				onSubmit={(e) => {
					e.preventDefault();
					if (busy || blockedReason) return;
					onSend();
				}}
				onKeyDown={(e) => {
					// Escape clears the slot; it never stops a reply. Dialogs opened
					// from the notice are portalled out, and handle their own Escape.
					if (e.key !== "Escape" || !e.currentTarget.contains(e.target as Node))
						return;
					if (notice) composer.dismissNotice();
					else if (attachment) composer.removeAttachment();
					else return;
					e.preventDefault();
				}}
			>
				{notice ? (
					<div className="mb-2">
						<ComposerNotice
							notice={notice}
							book={
								notice.kind === "out_of_scope"
									? books.find((b) => b.editionId === notice.editionId)
									: undefined
							}
							conversationId={conversationId}
							busy={busy}
							onWhole={(ref) =>
								void composer.attachPassage({ locator: ref.locator })
							}
							onDismiss={composer.dismissNotice}
						/>
					</div>
				) : (
					attachment && (
						<div className="mb-2">
							<AttachmentChip
								key={keyOf(attachment)}
								attachment={attachment}
								onRemove={composer.removeAttachment}
							/>
						</div>
					)
				)}
				<div className="flex items-end gap-2">
					<AutogrowTextarea
						ref={composer.inputRef}
						value={draft}
						onValueChange={composer.setDraft}
						onPaste={(e) => {
							// Only a paste that is exactly one passage link becomes a reference.
							const ref = parsePassageLink(
								e.clipboardData.getData("text/plain"),
								window.location.origin,
							);
							if (!ref) return;
							e.preventDefault();
							void composer.attachPassage(ref);
						}}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing) return;
							// On desktop Enter sends; Shift+Enter, and Enter on touch, fall
							// through to a newline that may continue a list.
							if (e.key === "Enter" && !e.shiftKey && !coarse) {
								e.preventDefault();
								if (!busy && !blockedReason)
									e.currentTarget.form?.requestSubmit();
							}
						}}
						name="message"
						maxLength={MESSAGE_LIMIT}
						aria-label="Message"
						placeholder="Say what you think…"
						containerClassName="min-w-0 flex-1"
						className="px-2 py-1.5 text-base sm:text-sm"
					/>
					<SendButton busy={busy} reason={blockedReason} onStop={onStop} />
				</div>
				{draft.length >= COUNTER_FROM && (
					<p
						className={`px-2 pt-1 text-right text-xs tabular-nums ${remaining <= 0 ? "text-destructive-foreground" : "text-muted-foreground"}`}
						aria-live="polite"
						data-testid="composer-counter"
					>
						{remaining.toLocaleString()}{" "}
						{remaining === 1 ? "character" : "characters"} left
					</p>
				)}
			</form>
			<ComposerHint />
		</>
	);
}

/** The keyboard shortcuts, for devices with a keyboard. */
function ComposerHint() {
	return (
		<p
			className="mt-1.5 text-center text-xs text-muted-foreground pointer-coarse:hidden"
			data-testid="composer-hint"
		>
			<kbd className="font-sans">Enter</kbd> to send ·{" "}
			<kbd className="font-sans">Shift+Enter</kbd> for a new line · Esc removes
			the attachment
		</p>
	);
}
