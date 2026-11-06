import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Composer, type ComposerBook } from "#/components/book-composer";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { getAiStatusFn } from "#/fns/conversations";
import { newConversationDraftId } from "#/lib/composer-draft";

/**
 * The app header's "New conversation" control: a dialog with the composer
 * holding no books yet. A filled primary button, so it stands out from the
 * Settings and Log out controls. Icon-only below lg, still named for
 * assistive tech.
 */
export function NewConversation({
	book,
	compact = true,
}: {
	book?: ComposerBook;
	/** The header uses an icon-only trigger at narrower widths. */
	compact?: boolean;
} = {}) {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					type="button"
					size="default"
					aria-label="New conversation"
					className={
						compact
							? "max-lg:size-10 max-lg:px-0 max-sm:size-11"
							: "min-h-11 px-5"
					}
				>
					<Plus aria-hidden strokeWidth={2} />
					<span className={compact ? "max-lg:sr-only" : undefined}>
						New conversation
					</span>
				</Button>
			</DialogTrigger>
			<DialogContent
				className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]"
				data-testid="header-new-conversation-dialog"
			>
				<DialogHeader className="shrink-0 border-b p-5 pr-14 text-left sm:p-7 sm:pr-16">
					<DialogTitle className="text-[38px]">New conversation</DialogTitle>
					<DialogDescription>
						Choose up to three books and ask a question.
					</DialogDescription>
				</DialogHeader>
				<DialogClose asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="absolute top-5 right-5"
						aria-label="Close new conversation"
					>
						<X aria-hidden />
					</Button>
				</DialogClose>
				{/* Only the body scrolls: long scopes and additional books cannot push
				    the dismissal action out of the viewport. Native focus scrolling
				    keeps the composer's Start action reachable by keyboard too. */}
				<div
					className="min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-7"
					data-testid="new-conversation-body"
				>
					{/* Mounted only while open, so the AI status is fetched on opening. */}
					<NewConversationComposer
						book={book}
						onStarted={() => setOpen(false)}
					/>
				</div>
				<div className="flex shrink-0 justify-end border-t bg-card px-5 py-3 sm:px-7">
					<DialogClose asChild>
						<Button type="button" variant="ghost">
							Cancel
						</Button>
					</DialogClose>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function NewConversationComposer({
	book,
	onStarted,
}: {
	book?: ComposerBook;
	onStarted: () => void;
}) {
	const aiStatus = useQuery({
		queryKey: ["ai-status"],
		queryFn: () => getAiStatusFn(),
		// Settings may have changed since it was last read.
		refetchOnMount: "always",
	});
	if (aiStatus.isError)
		return (
			<p role="alert" className="text-sm text-destructive-foreground">
				Could not check the AI settings. Close this and try again.
			</p>
		);
	if (!aiStatus.data)
		return <p className="text-sm text-muted-foreground">Loading…</p>;
	return (
		<Composer
			initialBooks={book ? [book] : []}
			draftId={book ? `new:${book.editionId}` : newConversationDraftId}
			status={aiStatus.data}
			onStarted={onStarted}
		/>
	);
}
