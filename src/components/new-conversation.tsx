import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Composer } from "#/components/book-composer";
import { Button } from "#/components/ui/button";
import {
	Dialog,
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
export function NewConversation() {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					type="button"
					size="default"
					aria-label="New conversation"
					className="max-lg:size-10 max-lg:px-0 max-sm:size-11"
				>
					<Plus aria-hidden strokeWidth={2} />
					<span className="max-lg:sr-only">New conversation</span>
				</Button>
			</DialogTrigger>
			<DialogContent
				className="sm:max-w-2xl"
				data-testid="header-new-conversation-dialog"
			>
				<DialogHeader>
					<DialogTitle>New conversation</DialogTitle>
					<DialogDescription>
						Choose up to three books and ask a question.
					</DialogDescription>
				</DialogHeader>
				{/* Mounted only while open, so the AI status is fetched on opening. */}
				<NewConversationComposer onStarted={() => setOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}

function NewConversationComposer({ onStarted }: { onStarted: () => void }) {
	const aiStatus = useQuery({
		queryKey: ["ai-status"],
		queryFn: () => getAiStatusFn(),
		// Settings may have changed since it was last read.
		refetchOnMount: "always",
	});
	if (aiStatus.isError)
		return (
			<p role="alert" className="text-sm text-destructive">
				Could not check the AI settings. Close this and try again.
			</p>
		);
	if (!aiStatus.data)
		return <p className="text-sm text-muted-foreground">Loading…</p>;
	return (
		<Composer
			initialBooks={[]}
			draftId={newConversationDraftId}
			status={aiStatus.data}
			onStarted={onStarted}
		/>
	);
}
