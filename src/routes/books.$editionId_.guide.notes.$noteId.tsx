import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "cn";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { boundKey, GuideError, useGuide } from "#/components/guide";
import {
	Attachment,
	asOfText,
	draftOf,
	NoteBody,
	NoteEditor,
	noteFrame,
	YourNoteBadge,
} from "#/components/guide-notes";
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
import { deleteNoteFn, getGuideNoteFn } from "#/fns/guide";

export const Route = createFileRoute("/books/$editionId_/guide/notes/$noteId")({
	beforeLoad: ({ params }) => {
		if (!/^[1-9]\d{0,9}$/.test(params.noteId)) throw notFound();
	},
	component: NoteView,
});

/** One note within the bound: read it, edit it, or delete it. */
function NoteView() {
	const id = Number(Route.useParams().noteId);
	const { editionId, bound, units, onStaleBound } = useGuide();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const remove = useServerFn(deleteNoteFn);
	const [editing, setEditing] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const note = useQuery({
		queryKey: ["guide", editionId, "note", id, bound ? boundKey(bound) : null],
		queryFn: () =>
			getGuideNoteFn({
				data: { editionId, bound: bound?.choice ?? { kind: "whole" }, id },
			}),
		enabled: bound !== null,
	});
	const stale = note.data?.ok === false && note.data.reason === "stale_bound";
	useEffect(() => {
		if (stale) onStaleBound();
	}, [stale, onStaleBound]);

	const back = (
		<p className="text-sm">
			<Link
				to="/books/$editionId/guide/notes"
				params={{ editionId }}
				className="text-muted-foreground hover:underline"
			>
				← Notes
			</Link>
		</p>
	);
	if (bound === null)
		return (
			<section className="space-y-3">
				{back}
				<p className="text-sm text-muted-foreground">
					Choose how far you have read to see this note.
				</p>
			</section>
		);
	if (note.isPending)
		return <p className="text-sm text-muted-foreground">Loading…</p>;
	if (note.isError || !note.data.ok)
		return <GuideError>Could not load this note.</GuideError>;
	const shown = note.data.note;
	if (!shown)
		return (
			<section className="space-y-3">
				{back}
				<p className="text-sm text-muted-foreground" data-testid="note-hidden">
					This note doesn't exist, or it is written as of a later point than the
					Guide shows ({bound.label ? `through ${bound.label}` : "whole book"}).
				</p>
			</section>
		);

	if (editing)
		return (
			<section aria-labelledby="edit-note" className="space-y-4">
				{back}
				<h2 id="edit-note" className="font-serif text-2xl font-semibold">
					Edit note
				</h2>
				<NoteEditor
					noteId={shown.id}
					initial={draftOf(shown)}
					units={units}
					onSaved={() => setEditing(false)}
					onCancel={() => setEditing(false)}
				/>
			</section>
		);

	return (
		<section aria-labelledby="note-title" className="space-y-4">
			{back}
			<article className={cn(noteFrame, "p-4")} data-testid="reader-note">
				<div className="flex flex-wrap items-center gap-2">
					<YourNoteBadge />
					<h2 id="note-title" className="font-serif text-2xl font-semibold">
						{shown.title}
					</h2>
				</div>
				<p className="mt-1 text-xs text-muted-foreground">
					{asOfText(shown.asOf)}
					<Attachment note={shown} editionId={editionId} />
					{shown.sourceConversationId && (
						<>
							{" · saved from a "}
							<Link
								to="/c/$conversationId"
								params={{ conversationId: shown.sourceConversationId }}
								className="underline-offset-2 hover:underline"
							>
								conversation
							</Link>
						</>
					)}
				</p>
				<div className="mt-3">
					<NoteBody body={shown.body} />
				</div>
			</article>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => setEditing(true)}
					data-testid="note-edit"
				>
					<Pencil aria-hidden /> Edit
				</Button>
				<AlertDialog onOpenChange={() => setDeleteError(null)}>
					<AlertDialogTrigger asChild>
						<Button
							type="button"
							size="sm"
							variant="outline"
							data-testid="note-delete"
						>
							<Trash2 aria-hidden /> Delete
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete “{shown.title}”?</AlertDialogTitle>
							<AlertDialogDescription>
								The note is removed from the Guide. This cannot be undone.
							</AlertDialogDescription>
							{deleteError && (
								<p className="text-sm text-destructive-foreground">
									{deleteError}
								</p>
							)}
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								className={buttonVariants({ variant: "destructive" })}
								onClick={async (event) => {
									// Keep the dialog open until the delete finishes.
									event.preventDefault();
									try {
										await remove({ data: { editionId, id: shown.id } });
										await queryClient.invalidateQueries({
											queryKey: ["guide", editionId],
										});
										await navigate({
											to: "/books/$editionId/guide/notes",
											params: { editionId },
										});
									} catch {
										setDeleteError(
											"Could not delete the note. Please try again.",
										);
									}
								}}
							>
								Delete
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</section>
	);
}
