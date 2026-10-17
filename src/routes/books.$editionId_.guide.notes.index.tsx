import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { NotebookPen } from "lucide-react";
import { useEffect } from "react";
import { boundKey, GuideError, useGuide } from "#/components/guide";
import { NoteCard } from "#/components/guide-notes";
import { buttonVariants } from "#/components/ui/button";
import { listGuideNotesFn } from "#/fns/guide";

export const Route = createFileRoute("/books/$editionId_/guide/notes/")({
	component: NotesView,
});

/** Every note visible within the bound. Works without preprocessing. */
function NotesView() {
	const { editionId, bound, onStaleBound } = useGuide();
	const notes = useQuery({
		queryKey: ["guide", editionId, "notes", bound ? boundKey(bound) : null],
		queryFn: () =>
			listGuideNotesFn({
				data: { editionId, bound: bound?.choice ?? { kind: "whole" } },
			}),
		enabled: bound !== null,
	});
	const stale = notes.data?.ok === false && notes.data.reason === "stale_bound";
	useEffect(() => {
		if (stale) onStaleBound();
	}, [stale, onStaleBound]);

	const newNote = (
		<Link
			to="/books/$editionId/guide/notes/new"
			params={{ editionId }}
			className={buttonVariants({ size: "sm" })}
			data-testid="new-note"
		>
			<NotebookPen aria-hidden /> New note
		</Link>
	);
	if (bound === null) {
		return (
			<section aria-label="Notes" className="space-y-3">
				{newNote}
				<p className="text-sm text-muted-foreground">
					Choose how far you have read to see your notes. Each note shows only
					from the point in the book it was written as of.
				</p>
			</section>
		);
	}
	if (notes.isPending)
		return <p className="text-sm text-muted-foreground">Loading notes…</p>;
	if (notes.isError || !notes.data.ok)
		return <GuideError>Could not load your notes.</GuideError>;
	const list = notes.data.notes;
	return (
		<section aria-label="Notes" className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground">
					Your own pages: theories, timelines, anything. Each shows only from
					the point in the book it was written as of.
				</p>
				{newNote}
			</div>
			{list.length === 0 ? (
				<p className="text-sm text-muted-foreground" data-testid="notes-empty">
					No notes {bound.label ? `through ${bound.label}` : "for this book"}{" "}
					yet.
				</p>
			) : (
				<ul className="space-y-3">
					{list.map((note) => (
						<li key={note.id}>
							<NoteCard note={note} editionId={editionId} />
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
