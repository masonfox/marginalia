import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, Pencil, Trash2 } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";
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
import { getReadingPositionFn, setReadingPositionFn } from "#/fns/guide";
import { clearComposerDraft } from "#/lib/composer-draft";
import type { Scope } from "#/modules/conversation";
import type { ReadingPosition } from "#/modules/guide";

/** A scope a conversation was just widened to, offered as the book's reading position. */
export interface PositionOffer {
	editionId: string;
	title: string;
	choice: Scope;
	/** The unit's label; null for whole book. */
	label: string | null;
}

/**
 * Whether widening to `choice` should offer to update the reading position:
 * when the position is unset, or the choice is past it.
 */
export function offersPositionUpdate(
	position: ReadingPosition | null,
	choice: Scope,
): boolean {
	if (position === null) return true;
	if (position.kind === "finished") return false;
	return choice.kind === "whole" || choice.endPosition > position.maxPosition;
}

interface PositionOfferState {
	offer: (offer: PositionOffer) => void;
	current: PositionOffer | null;
	dismiss: () => void;
}

const PositionOfferContext = createContext<PositionOfferState | null>(null);

/** Offers a widened scope as the reading position; null outside a conversation. */
export function usePositionOffer(): PositionOfferState["offer"] | null {
	return useContext(PositionOfferContext)?.offer ?? null;
}

/** Holds the pending "Also update my reading position?" offer for a conversation page. */
export function PositionOfferProvider({ children }: { children: ReactNode }) {
	const [current, setCurrent] = useState<PositionOffer | null>(null);
	const offer = useCallback(async (next: PositionOffer) => {
		try {
			const position = await getReadingPositionFn({
				data: { editionId: next.editionId },
			});
			setCurrent(offersPositionUpdate(position, next.choice) ? next : null);
		} catch {
			// Without the current position there is nothing safe to offer.
			setCurrent(null);
		}
	}, []);
	const dismiss = useCallback(() => setCurrent(null), []);
	return (
		<PositionOfferContext.Provider
			value={{ offer: (o) => void offer(o), current, dismiss }}
		>
			{children}
		</PositionOfferContext.Provider>
	);
}

/**
 * The non-blocking offer shown after widening past the reading position.
 * Accepting sets the position as an ordinary forward move; declining
 * changes nothing.
 */
export function PositionUpdateOffer() {
	const state = useContext(PositionOfferContext);
	const queryClient = useQueryClient();
	const set = useServerFn(setReadingPositionFn);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const offer = state?.current;
	if (!state || !offer) return null;
	const target = offer.label ?? "Finished";
	const close = () => {
		setError(null);
		state.dismiss();
	};
	return (
		<section
			aria-label="Update reading position"
			className="mt-3 rounded-md border px-3 py-2 text-sm"
			data-testid="position-offer"
		>
			<p className="flex items-center gap-2 font-medium">
				<Bookmark className="size-4 shrink-0" aria-hidden />
				Also update my reading position?
			</p>
			<p className="mt-1">
				Set your reading position in “{offer.title}” to {target}. It is shared
				by everyone using this Marginalia instance.
			</p>
			{error && (
				<p role="alert" className="mt-1 text-destructive-foreground">
					{error}
				</p>
			)}
			<div className="mt-2 flex flex-wrap gap-2">
				<Button
					type="button"
					size="sm"
					disabled={busy}
					onClick={async () => {
						setBusy(true);
						setError(null);
						try {
							const result = await set({
								data: { editionId: offer.editionId, choice: offer.choice },
							});
							await queryClient.invalidateQueries({
								queryKey: ["reading-position", offer.editionId],
							});
							if (result.set) close();
							else if (result.reason === "move_back")
								setError("Your reading position is already further along.");
							else if (result.reason === "stale_scope")
								setError(
									"This book's chapters changed. Set your position from the book's page.",
								);
							else setError("This book is not available.");
						} catch {
							setError("Could not update your reading position.");
						}
						setBusy(false);
					}}
				>
					Update position
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					disabled={busy}
					onClick={close}
				>
					No thanks
				</Button>
			</div>
		</section>
	);
}

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
								clearComposerDraft(conversationId);
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
