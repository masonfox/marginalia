import { BookOpen, ChevronDown, Quote, X } from "lucide-react";
import { useId, useState } from "react";
import { PassageQuote } from "#/components/passage-quote";
import { ReplyQuote } from "#/components/reply-selection";
import { Button } from "#/components/ui/button";
import type { Attachment } from "./use-composer";

/**
 * The pending attachment as a one-line chip: its source and an excerpt, with
 * controls to expand it to the full text and to remove it. Starts collapsed;
 * key it by the attachment so a new one does too.
 */
export function AttachmentChip({
	attachment,
	onRemove,
}: {
	attachment: Attachment;
	onRemove: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const bodyId = useId();
	const passage = attachment.kind === "passage";
	const label = passage
		? ["Passage from the book", attachment.snapshot.bookTitle]
				.concat(attachment.snapshot.sectionTitle ?? [])
				.join(" · ")
		: "Replying to assistant";
	const text = passage ? attachment.snapshot.text : attachment.quote.text;
	const Icon = passage ? BookOpen : Quote;
	return (
		<div
			className="rounded-lg border bg-muted/40 text-sm"
			data-testid="attachment-chip"
			data-kind={attachment.kind}
		>
			<div className="flex items-center gap-1 py-1 pr-1 pl-2.5">
				<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
				<button
					type="button"
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					aria-label={`Show full ${passage ? "passage" : "quote"}: ${label}`}
					aria-expanded={expanded}
					aria-controls={bodyId}
					onClick={() => setExpanded(!expanded)}
				>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate text-xs font-medium text-muted-foreground">
							{label}
						</span>
						{!expanded && (
							<span
								className={`truncate ${passage ? "font-serif" : ""}`}
								data-testid="attachment-excerpt"
							>
								{text.replace(/\s+/g, " ")}
							</span>
						)}
					</span>
					<ChevronDown
						className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
						aria-hidden
					/>
				</button>
				<Button
					type="button"
					size="icon-sm"
					variant="ghost"
					className="rounded-full"
					aria-label={passage ? "Remove passage" : "Remove quote"}
					title={passage ? "Remove passage" : "Remove quote"}
					onClick={onRemove}
				>
					<X aria-hidden />
				</Button>
			</div>
			<div
				id={bodyId}
				hidden={!expanded}
				className="max-h-[8lh] overflow-y-auto border-t px-3 pt-2"
			>
				{passage ? (
					<PassageQuote snapshot={attachment.snapshot} />
				) : (
					<ReplyQuote quote={attachment.quote} />
				)}
			</div>
		</div>
	);
}
