import { useCoarsePointer } from "#/hooks/use-coarse-pointer";
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

/** Why Send waits while another part of the conversation is replying. */
const IN_PROGRESS = "A reply is in progress";

/** The remaining-character count appears from here on. */
const COUNTER_FROM = 7200;

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
	elsewhere = false,
	label = "Message",
	onSend,
	onStop,
}: {
	composer: ComposerState;
	conversationId: string;
	books: ConversationBook[];
	/** This composer's own reply is generating; Send becomes Stop. */
	busy: boolean;
	/**
	 * A reply is generating in another part of the conversation (the main
	 * conversation or a thread), so sending waits; the draft stays editable.
	 */
	elsewhere?: boolean;
	/** The message input's accessible name. */
	label?: string;
	onSend: () => void;
	onStop: () => void;
}) {
	const coarse = useCoarsePointer();
	const { draft, attachment, notice } = composer;
	const blockedReason = elsewhere ? IN_PROGRESS : composer.blockedReason;
	const remaining = MESSAGE_LIMIT - draft.length;
	return (
		<>
			{elsewhere && !busy && (
				<output
					className="mb-2 block text-center text-xs text-muted-foreground"
					data-testid="reply-in-progress"
				>
					{IN_PROGRESS}. You can keep typing.
				</output>
			)}
			<form
				className="overflow-hidden rounded-2xl border border-input bg-card p-3 shadow-pop focus-within:border-ring/60 sm:p-4"
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
						aria-label={label}
						placeholder="Say what you think…"
						containerClassName="min-w-0 flex-1"
						className="px-2 py-2 text-base leading-relaxed"
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
			className="mt-2 text-center text-[11px] text-faint-foreground pointer-coarse:hidden"
			data-testid="composer-hint"
		>
			<kbd className="font-sans">Enter</kbd> to send ·{" "}
			<kbd className="font-sans">Shift+Enter</kbd> for a new line · Esc removes
			the attachment
		</p>
	);
}
