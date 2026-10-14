import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button, buttonVariants } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	deleteConversationFn,
	renameConversationFn,
} from "#/fns/conversations";

/** A rename button that swaps to an inline form. Refreshes the page data when saved. */
export function RenameConversation({
	conversationId,
	title,
}: {
	conversationId: string;
	title: string;
}) {
	const router = useRouter();
	const rename = useServerFn(renameConversationFn);
	const [editing, setEditing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!editing) {
		return (
			<Button
				type="button"
				size="sm"
				variant="ghost"
				onClick={() => setEditing(true)}
				aria-label={`Rename “${title}”`}
			>
				<Pencil aria-hidden /> Rename
			</Button>
		);
	}
	return (
		<form
			className="flex items-center gap-2"
			onSubmit={async (e) => {
				e.preventDefault();
				const value = new FormData(e.currentTarget).get("title");
				const next = typeof value === "string" ? value.trim() : "";
				if (!next) return;
				setError(null);
				try {
					await rename({ data: { conversationId, title: next } });
					setEditing(false);
					await router.invalidate();
				} catch {
					setError("Could not rename. Please try again.");
				}
			}}
		>
			<Input
				name="title"
				defaultValue={title}
				aria-label="Conversation title"
				maxLength={200}
				autoFocus
			/>
			<Button type="submit" size="sm">
				Save
			</Button>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				onClick={() => setEditing(false)}
			>
				Cancel
			</Button>
			{error && (
				<span className="text-sm text-destructive-foreground">{error}</span>
			)}
		</form>
	);
}

/** A delete button with a confirmation dialog. */
export function DeleteConversation({
	conversationId,
	title,
	onDeleted,
}: {
	conversationId: string;
	title: string;
	onDeleted: () => void | Promise<void>;
}) {
	const remove = useServerFn(deleteConversationFn);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<AlertDialog onOpenChange={() => setError(null)}>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					aria-label={`Delete “${title}”`}
				>
					<Trash2 aria-hidden /> Delete
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
					<AlertDialogDescription>
						The conversation and all its messages will be removed. The book is
						not affected. This cannot be undone.
					</AlertDialogDescription>
					{error && (
						<p className="text-sm text-destructive-foreground">{error}</p>
					)}
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						className={buttonVariants({ variant: "destructive" })}
						disabled={busy}
						onClick={async (event) => {
							// Keep the dialog open until the delete finishes.
							event.preventDefault();
							setBusy(true);
							setError(null);
							try {
								await remove({ data: { conversationId } });
								await onDeleted();
							} catch {
								setError("Could not delete. Please try again.");
								setBusy(false);
							}
						}}
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
