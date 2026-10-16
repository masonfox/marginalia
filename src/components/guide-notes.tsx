// Reader notes in the Guide: the editor with its anchor and attachment
// pickers, and how a note is shown. Notes are the reader's own words, so
// they are always set apart from generated content and rendered as Markdown
// without raw HTML.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "cn";
import { NotebookPen } from "lucide-react";
import { useId, useState } from "react";
import { UserMarkdown } from "#/components/chat";
import { boundKey, KIND_LABELS, useGuide } from "#/components/guide";
import { passageLocator } from "#/components/guide-subjects";
import {
	type Choice,
	groupUnits,
	positionChoice,
	ScopeChoices,
} from "#/components/scope";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { createNoteFn, listGuideSubjectsFn, updateNoteFn } from "#/fns/guide";
import type { ReadingUnit } from "#/modules/catalog";
import type {
	GuideNote,
	NoteAnchorChoice,
	NoteAsOf,
	NoteAttachment,
	ReaderNote,
} from "#/modules/guide";

/** Mirrors the server's limits (MAX_NOTE_TITLE, MAX_NOTE_BODY). */
export const MAX_TITLE = 200;
export const MAX_BODY = 20_000;

/** "As of Chapter 12", "As of a passage in Chapter 3", "As of the end of the book". */
export function asOfText(asOf: NoteAsOf): string {
	if (asOf.kind === "end") return "As of the end of the book";
	if (asOf.kind === "passage")
		return asOf.label ? `As of a passage in ${asOf.label}` : "As of a passage";
	return `As of ${asOf.label ?? "a chapter"}`;
}

/**
 * A note's Markdown body. Raw HTML shows as the text the reader typed and is
 * never rendered, the way a reader's chat messages are.
 */
export function NoteBody({ body }: { body: string }) {
	if (!body.trim())
		return <p className="text-sm text-muted-foreground italic">No text.</p>;
	return (
		<div className="text-sm" data-testid="note-body">
			<UserMarkdown text={body} />
		</div>
	);
}

/** The frame that sets a reader note apart from generated content. */
export const noteFrame =
	"rounded-md border border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10";

/** Marks a note as the reader's own writing. */
export function YourNoteBadge() {
	return (
		<Badge variant="outline" className="border-amber-500/50">
			<NotebookPen aria-hidden /> Your note
		</Badge>
	);
}

/** A note in a list: its title, anchor, attachment, and the start of its body. */
export function NoteCard({
	note,
	editionId,
	showAttachment = true,
}: {
	note: GuideNote;
	editionId: string;
	showAttachment?: boolean;
}) {
	return (
		<article className={cn(noteFrame, "p-3")} data-testid="reader-note">
			<div className="flex flex-wrap items-center gap-2">
				<YourNoteBadge />
				<h3 className="font-medium">
					<Link
						to="/books/$editionId/guide/notes/$noteId"
						params={{ editionId, noteId: String(note.id) }}
						className="hover:underline"
					>
						{note.title}
					</Link>
				</h3>
			</div>
			<p className="mt-1 text-xs text-muted-foreground">
				{asOfText(note.asOf)}
				{showAttachment && <Attachment note={note} editionId={editionId} />}
			</p>
			<div className="relative mt-2 max-h-32 overflow-hidden">
				<NoteBody body={note.body} />
			</div>
		</article>
	);
}

/** " · about Brawne Lamia" or " · on Chapter 3", linked to where it is shown. */
export function Attachment({
	note,
	editionId,
}: {
	note: GuideNote;
	editionId: string;
}) {
	if (note.subject) {
		// No name at the bound: the subject has not appeared, so it is not named.
		if (note.subject.name === null || note.subject.ref === null) return null;
		return (
			<>
				{" · about "}
				<Link
					to="/books/$editionId/guide/index/$subjectRef"
					params={{ editionId, subjectRef: note.subject.ref }}
					className="underline-offset-2 hover:underline"
				>
					{note.subject.name}
				</Link>
			</>
		);
	}
	if (note.unit) {
		return (
			<>
				{" · on "}
				<Link
					to="/books/$editionId/guide/chapters"
					params={{ editionId }}
					className="underline-offset-2 hover:underline"
				>
					{note.unit.label}
				</Link>
			</>
		);
	}
	return null;
}

/** Notes attached to a chapter or subject, shown with it. */
export function AttachedNotes({
	notes,
	editionId,
}: {
	notes: GuideNote[];
	editionId: string;
}) {
	if (notes.length === 0) return null;
	return (
		<ul className="mt-3 space-y-2" aria-label="Your notes">
			{notes.map((note) => (
				<li key={note.id}>
					<NoteCard note={note} editionId={editionId} showAttachment={false} />
				</li>
			))}
		</ul>
	);
}

/** Starts a note attached to a chapter (`unit`) or a subject (`subject`). */
export function AddNoteLink({
	editionId,
	search,
	children = "Add a note",
}: {
	editionId: string;
	search: { unit: string } | { subject: string };
	children?: string;
}) {
	return (
		<Link
			to="/books/$editionId/guide/notes/new"
			params={{ editionId }}
			search={search}
			className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
			data-testid="add-note"
		>
			<NotebookPen className="size-3" aria-hidden /> {children}
		</Link>
	);
}

/**
 * What the editor starts from and saves. A new note's draft comes from the
 * Guide (the default anchor, and a chapter or subject it was opened from);
 * other flows can supply their own, such as a saved excerpt.
 */
export interface NoteDraft {
	title: string;
	body: string;
	/** Null until the reader chooses, when there is no default. */
	anchor: NoteAnchorChoice | null;
	attachment: NoteAttachment;
	/** The conversation the note is saved from, if any. */
	sourceConversationId?: string | null;
	/** Display names for an attached subject the subject list may not include. */
	subjectName?: string | null;
}

/**
 * A new note's draft: anchored at the default (the reading position, or
 * null when the reader must choose), attached to the chapter or subject it
 * was opened from.
 */
export function newNoteDraft(
	defaultAnchor: NoteAnchorChoice | null,
	from: { unit?: string; subject?: string },
): NoteDraft {
	return {
		title: "",
		body: "",
		anchor: defaultAnchor,
		attachment: from.subject
			? { kind: "subject", ref: from.subject }
			: from.unit
				? { kind: "unit", unitLocator: from.unit }
				: { kind: "none" },
		sourceConversationId: null,
	};
}

/** The draft of a stored note, for editing it. */
export function draftOf(note: GuideNote): NoteDraft {
	return {
		title: note.title,
		body: note.body,
		anchor:
			note.asOf.kind === "end"
				? { kind: "end" }
				: note.asOf.kind === "unit"
					? { kind: "unit", endPosition: note.asOf.position as number }
					: { kind: "passage", locator: note.asOf.locator as string },
		// A withheld subject keeps an empty ref: left unchanged, the attachment
		// is not sent, so the stored one is kept.
		attachment: note.subject
			? { kind: "subject", ref: note.subject.ref ?? "" }
			: note.unit
				? { kind: "unit", unitLocator: note.unit.locator }
				: { kind: "none" },
		sourceConversationId: note.sourceConversationId,
		subjectName: note.subject
			? (note.subject.name ?? note.subject.key ?? "A subject not yet seen")
			: null,
	};
}

const sameJson = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);

const toChoice = (anchor: NoteAnchorChoice | null): Choice | null =>
	anchor?.kind === "end"
		? "whole"
		: anchor?.kind === "unit"
			? `unit:${anchor.endPosition}`
			: null;

const fromChoice = (choice: Choice): NoteAnchorChoice =>
	choice === "whole"
		? { kind: "end" }
		: { kind: "unit", endPosition: Number(choice.slice(5)) };

const NOTE_ANCHOR_LABELS = {
	whole: "The end of the book",
	wholeHint: "Written after finishing it: shown only with the whole book.",
	partway: "As of a chapter",
};

/**
 * Where a note is written "as of": a chapter (through ScopeChoices), the end
 * of the book, or a specific passage pasted from the reader. Nothing is
 * chosen when there is no default.
 */
function NoteAnchorPicker({
	units,
	value,
	onChange,
	position,
}: {
	units: ReadingUnit[];
	value: NoteAnchorChoice | null;
	onChange: (anchor: NoteAnchorChoice | null) => void;
	position: Choice | null;
}) {
	const id = useId();
	const [passage, setPassage] = useState(
		value?.kind === "passage" ? value.locator : "",
	);
	// The last chapter or end choice, restored when the passage is cleared.
	const [choice, setChoice] = useState<Choice | null>(toChoice(value));
	return (
		<fieldset className="grid gap-2" data-testid="note-anchor">
			<legend className="mb-1 font-medium">Written as of</legend>
			<p className="text-xs text-muted-foreground">
				The note shows in the Guide, and to conversations, only from this point
				on, so it never spoils an earlier view.
			</p>
			<ScopeChoices
				units={units}
				value={value?.kind === "passage" ? null : choice}
				position={position}
				legend="Written as of"
				labels={NOTE_ANCHOR_LABELS}
				onChange={(next) => {
					setChoice(next);
					setPassage("");
					onChange(fromChoice(next));
				}}
			/>
			<label className="grid gap-1" htmlFor={`${id}-passage`}>
				<span>
					Or a specific passage{" "}
					<span className="text-muted-foreground">(optional)</span>
				</span>
				<Input
					id={`${id}-passage`}
					value={passage}
					onChange={(e) => {
						const text = e.currentTarget.value;
						setPassage(text);
						const locator = passageLocator(text);
						onChange(
							locator
								? { kind: "passage", locator }
								: choice
									? fromChoice(choice)
									: null,
						);
					}}
					placeholder="Paste a passage link from the reader"
					data-testid="note-anchor-passage"
				/>
			</label>
		</fieldset>
	);
}

const selectClass =
	"h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Attaches a note to nothing, one chapter, or one subject seen within the bound. */
function NoteAttachmentPicker({
	units,
	value,
	onChange,
	subjectName,
}: {
	units: ReadingUnit[];
	value: NoteAttachment;
	onChange: (attachment: NoteAttachment) => void;
	subjectName: string | null;
}) {
	const id = useId();
	const { editionId, bound, preprocessed } = useGuide();
	const listSubjects = useServerFn(listGuideSubjectsFn);
	const subjects = useQuery({
		queryKey: ["guide", editionId, "subjects", bound ? boundKey(bound) : null],
		queryFn: () =>
			listSubjects({
				data: { editionId, bound: bound?.choice ?? { kind: "whole" } },
			}),
		enabled: preprocessed && bound !== null,
	});
	const listed = subjects.data?.ok ? subjects.data.subjects : [];
	const chosenRef = value.kind === "subject" ? value.ref : "";
	const unlisted =
		value.kind === "subject" && !listed.some((s) => s.ref === chosenRef);
	const firstUnit = units[0]?.startLocator;
	return (
		<fieldset className="grid gap-2" data-testid="note-attachment">
			<legend className="mb-1 font-medium">Attached to</legend>
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				<label className="flex items-center gap-2">
					<input
						type="radio"
						name={`${id}-kind`}
						checked={value.kind === "none"}
						onChange={() => onChange({ kind: "none" })}
					/>
					Nothing
				</label>
				<label className="flex items-center gap-2">
					<input
						type="radio"
						name={`${id}-kind`}
						checked={value.kind === "unit"}
						disabled={!firstUnit}
						onChange={() => {
							if (firstUnit) onChange({ kind: "unit", unitLocator: firstUnit });
						}}
					/>
					A chapter
				</label>
				<label className="flex items-center gap-2">
					<input
						type="radio"
						name={`${id}-kind`}
						checked={value.kind === "subject"}
						disabled={listed.length === 0 && value.kind !== "subject"}
						onChange={() => {
							const first = listed[0];
							if (first) onChange({ kind: "subject", ref: first.ref });
						}}
					/>
					A subject
				</label>
			</div>
			{value.kind === "unit" && (
				<select
					aria-label="Chapter"
					className={selectClass}
					value={value.unitLocator}
					onChange={(e) =>
						onChange({ kind: "unit", unitLocator: e.currentTarget.value })
					}
					data-testid="note-attachment-unit"
				>
					{groupUnits(units).map((group) => {
						const options = group.units.map((u) => (
							<option key={u.startLocator} value={u.startLocator}>
								{u.label}
							</option>
						));
						return group.parent ? (
							<optgroup
								key={`${group.parent}:${group.units[0]?.ordinal}`}
								label={group.parent}
							>
								{options}
							</optgroup>
						) : (
							options
						);
					})}
				</select>
			)}
			{value.kind === "subject" && (
				<select
					aria-label="Subject"
					className={selectClass}
					value={chosenRef}
					onChange={(e) =>
						onChange({ kind: "subject", ref: e.currentTarget.value })
					}
					data-testid="note-attachment-subject"
				>
					{unlisted && (
						<option value={chosenRef}>{subjectName ?? chosenRef}</option>
					)}
					{listed.map((s) => (
						<option key={s.ref} value={s.ref}>
							{s.name} ({KIND_LABELS[s.kind].singular.toLowerCase()})
						</option>
					))}
				</select>
			)}
			{value.kind === "none" && listed.length === 0 && preprocessed && (
				<span className="text-xs text-muted-foreground">
					Subjects seen within the Guide's bound can be chosen here.
				</span>
			)}
		</fieldset>
	);
}

/**
 * Writes or edits a note: title, Markdown body (with a preview), its "as of"
 * anchor, and what it is attached to. Nothing is saved until the reader
 * saves. `initial` is the starting draft; for an existing note, only what
 * the reader changed of its anchor and attachment is sent.
 */
export function NoteEditor({
	noteId,
	initial,
	units,
	onSaved,
	onCancel,
}: {
	/** The note being edited; a new note when absent. */
	noteId?: number;
	initial: NoteDraft;
	units: ReadingUnit[];
	onSaved: (note: ReaderNote) => void;
	onCancel: () => void;
}) {
	const id = useId();
	const { editionId, position } = useGuide();
	const queryClient = useQueryClient();
	const create = useServerFn(createNoteFn);
	const update = useServerFn(updateNoteFn);
	const [title, setTitle] = useState(initial.title);
	const [body, setBody] = useState(initial.body);
	const [anchor, setAnchor] = useState(initial.anchor);
	const [attachment, setAttachment] = useState(initial.attachment);
	const [preview, setPreview] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const missing = !title.trim()
		? "Give the note a title."
		: anchor === null
			? "Choose how far into the book this note is written as of."
			: null;

	const save = async () => {
		if (missing || anchor === null) return;
		setBusy(true);
		setError(null);
		try {
			const draft = {
				editionId,
				title: title.trim(),
				body,
			};
			const result =
				noteId === undefined
					? await create({
							data: {
								...draft,
								anchor,
								attachment,
								sourceConversationId: initial.sourceConversationId ?? null,
							},
						})
					: await update({
							data: {
								...draft,
								id: noteId,
								...(sameJson(anchor, initial.anchor) ? {} : { anchor }),
								...(sameJson(attachment, initial.attachment)
									? {}
									: { attachment }),
							},
						});
			if (!result.ok) {
				setError(result.message);
				return;
			}
			await queryClient.invalidateQueries({ queryKey: ["guide", editionId] });
			onSaved(result.note);
		} catch {
			setError("Could not save the note. Please try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			className="space-y-5 text-sm"
			data-testid="note-editor"
			onSubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label className="grid gap-1" htmlFor={`${id}-title`}>
				<span className="font-medium">Title</span>
				<Input
					id={`${id}-title`}
					value={title}
					maxLength={MAX_TITLE}
					onChange={(e) => setTitle(e.currentTarget.value)}
					placeholder="Who is the Shrike?"
					data-testid="note-title"
				/>
			</label>
			<div className="grid gap-1">
				<div className="flex items-center justify-between gap-2">
					<label htmlFor={`${id}-body`} className="font-medium">
						Note{" "}
						<span className="font-normal text-muted-foreground">
							(Markdown)
						</span>
					</label>
					<div className="flex gap-1">
						<Button
							type="button"
							size="sm"
							variant={preview ? "ghost" : "secondary"}
							aria-pressed={!preview}
							onClick={() => setPreview(false)}
						>
							Write
						</Button>
						<Button
							type="button"
							size="sm"
							variant={preview ? "secondary" : "ghost"}
							aria-pressed={preview}
							onClick={() => setPreview(true)}
						>
							Preview
						</Button>
					</div>
				</div>
				{preview ? (
					<div className={cn(noteFrame, "min-h-40 p-3")}>
						<NoteBody body={body} />
					</div>
				) : (
					<textarea
						id={`${id}-body`}
						value={body}
						maxLength={MAX_BODY}
						rows={12}
						onChange={(e) => setBody(e.currentTarget.value)}
						className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						data-testid="note-body-input"
					/>
				)}
				<span className="text-right text-xs text-muted-foreground tabular-nums">
					{body.length.toLocaleString("en-US")} /{" "}
					{MAX_BODY.toLocaleString("en-US")}
				</span>
			</div>
			<NoteAnchorPicker
				units={units}
				value={anchor}
				onChange={setAnchor}
				position={positionChoice(position, units)}
			/>
			<NoteAttachmentPicker
				units={units}
				value={attachment}
				onChange={setAttachment}
				subjectName={initial.subjectName ?? null}
			/>
			{(error ?? (missing && title ? missing : null)) && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error ?? missing}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					type="submit"
					disabled={busy || missing !== null}
					data-testid="note-save"
				>
					{busy ? "Saving…" : noteId === undefined ? "Save note" : "Save"}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={busy}
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
