import { WidenScope } from "#/components/scope";
import { Button } from "#/components/ui/button";
import type { PassageRef } from "#/lib/passage-ref";
import type { ConversationBook } from "#/modules/conversation";
import type { Notice } from "./use-composer";

/** Checking a passage, or why an attachment was not made; shown in the chip's place. */
export function ComposerNotice({
	notice,
	book,
	conversationId,
	busy,
	onWhole,
	onDismiss,
}: {
	notice: Notice;
	book: ConversationBook | undefined;
	conversationId: string;
	busy: boolean;
	onWhole: (ref: PassageRef) => void;
	onDismiss: () => void;
}) {
	if (notice.kind === "checking")
		return (
			<output
				className="block rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground"
				data-testid="passage-status"
			>
				Checking passage…
			</output>
		);
	return (
		<div
			role="alert"
			className="rounded-lg border px-3 py-2 text-sm"
			data-testid="passage-status"
		>
			{notice.kind === "out_of_scope" ? (
				<p>
					This passage is in {notice.unitLabel ?? "a later part of the book"},
					beyond this conversation's scope. Widen the scope to attach it.
				</p>
			) : notice.kind === "quote_too_long" ? (
				<p>
					Select at most 2,000 characters to reply. Your existing quote is
					unchanged.
				</p>
			) : (
				<p>{notice.message}</p>
			)}
			<div className="mt-1 flex flex-wrap items-center gap-1">
				{notice.kind === "out_of_scope" && book && (
					<WidenScope
						conversationId={conversationId}
						book={book}
						disabled={busy}
					/>
				)}
				{notice.kind === "invalid" &&
					notice.reason === "bad_range" &&
					notice.ref.range && (
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => onWhole(notice.ref)}
						>
							Attach the whole passage
						</Button>
					)}
				<Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
					Dismiss
				</Button>
			</div>
		</div>
	);
}
