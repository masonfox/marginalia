import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { z } from "zod";
import { GuideError, useGuide } from "#/components/guide";
import { NoteEditor, newNoteDraft } from "#/components/guide-notes";
import { getNoteDefaultsFn } from "#/fns/guide";

export const Route = createFileRoute("/books/$editionId_/guide/notes/new")({
	// Opened from a chapter or a subject, to attach the note to it.
	validateSearch: z.object({
		unit: z.string().optional(),
		subject: z.string().optional(),
	}),
	component: NewNoteView,
});

/**
 * Writes a new note, anchored by default at the reading position. Nothing
 * is saved until the reader saves.
 */
function NewNoteView() {
	const { editionId, units } = useGuide();
	const search = Route.useSearch();
	const navigate = useNavigate();
	// "Save as note" from a conversation hands over a draft for this book.
	const handed = useRouterState({
		select: (s) => s.location.state.noteDraft,
	});
	const excerpt = handed?.editionId === editionId ? handed : null;
	const defaults = useQuery({
		queryKey: ["guide", editionId, "note-defaults"],
		queryFn: () => getNoteDefaultsFn({ data: { editionId } }),
	});
	if (defaults.isPending || units.length === 0)
		return <p className="text-sm text-muted-foreground">Loading…</p>;
	if (defaults.isError || !defaults.data)
		return <GuideError>Could not start a note for this book.</GuideError>;
	const anchor = defaults.data.anchor;
	return (
		<section aria-labelledby="new-note" className="space-y-4">
			<p className="text-sm">
				<Link
					to="/books/$editionId/guide/notes"
					params={{ editionId }}
					className="text-muted-foreground hover:underline"
				>
					← Notes
				</Link>
			</p>
			<h2 id="new-note" className="font-serif text-2xl font-semibold">
				New note
			</h2>
			<p className="text-xs text-muted-foreground" data-testid="note-default">
				{excerpt
					? `Saved from a conversation and written as of ${excerpt.anchorLabel ?? "the end of the book"}, the conversation's scope, unless you choose otherwise. Nothing is saved until you save the note.`
					: anchor
						? `Written as of ${anchor.choice.kind === "passage" ? `your place in ${anchor.label ?? "the book"}` : (anchor.label ?? "the end of the book")} unless you choose otherwise: your reading position.`
						: "No reading position is set, so choose how far into the book this note is written as of."}
			</p>
			<NoteEditor
				initial={
					excerpt
						? {
								...newNoteDraft(excerpt.anchor, search),
								title: excerpt.title,
								body: excerpt.body,
								sourceConversationId: excerpt.sourceConversationId,
							}
						: newNoteDraft(anchor?.choice ?? null, search)
				}
				units={units}
				onSaved={(note) =>
					void navigate({
						to: "/books/$editionId/guide/notes/$noteId",
						params: { editionId, noteId: String(note.id) },
					})
				}
				onCancel={() =>
					void navigate({
						to: "/books/$editionId/guide/notes",
						params: { editionId },
					})
				}
			/>
		</section>
	);
}
