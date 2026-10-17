import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Merge, Split, TriangleAlert, X } from "lucide-react";
import { useId, useState } from "react";
import { boundKey, KIND_LABELS, KINDS, useGuide } from "#/components/guide";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import {
	dismissProposalFn,
	listGuideProposalsFn,
	listGuideSubjectsFn,
	mergeSubjectsFn,
	renameSubjectFn,
	setSubjectKindFn,
	splitSubjectFn,
} from "#/fns/guide";
import type { ObservationKind } from "#/modules/analysis";
import type {
	MergeProposal,
	SubjectEditResult,
	SubjectTimeline,
} from "#/modules/guide";

const selectClass =
	"h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const EDIT_ERRORS: Record<
	Exclude<Extract<SubjectEditResult, { ok: false }>["reason"], "stale_bound">,
	string
> = {
	not_found: "This subject is no longer in the Guide at this bound.",
	stale_anchor:
		"That chapter or passage is no longer part of the book. Please choose again.",
	invalid: "That change doesn't apply to this subject.",
};

/**
 * Runs a subject edit at the visit's bound: refreshes the Guide on success
 * and reports a refusal. Resolves to the subject's new ref, or null.
 */
function useSubjectEdit() {
	const { editionId, bound, onStaleBound } = useGuide();
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const run = async (
		edit: (input: {
			editionId: string;
			bound: NonNullable<typeof bound>["choice"];
		}) => Promise<SubjectEditResult>,
	): Promise<string | null> => {
		if (!bound) return null;
		setBusy(true);
		setError(null);
		try {
			const result = await edit({ editionId, bound: bound.choice });
			if (!result.ok) {
				if (result.reason === "stale_bound") onStaleBound();
				else setError(EDIT_ERRORS[result.reason]);
				return null;
			}
			await queryClient.invalidateQueries({ queryKey: ["guide", editionId] });
			return result.ref;
		} catch {
			setError("Could not save the change. Please try again.");
			return null;
		} finally {
			setBusy(false);
		}
	};
	return { run, busy, error, setError };
}

/** A pasted passage link (`…/p/<locator>`) or a bare locator; null when empty. */
export function passageLocator(text: string): string | null {
	const value = text.trim();
	if (!value) return null;
	const match = /\/p\/([^/?#\s]+)/.exec(value);
	if (!match) return value;
	try {
		return decodeURIComponent(match[1] as string);
	} catch {
		return match[1] as string;
	}
}

/** One side of a merge, as the Guide shows it at the bound. */
export interface MergeSide {
	ref: string;
	name: string;
	/** End position of the unit it first appears in within the bound. */
	firstPosition: number;
}

/**
 * Confirms a merge. The reveal (where the two names start reading as one)
 * defaults as given, is always shown and editable, and comes with a spoiler
 * warning, because a default can be earlier than the book's own reveal.
 */
export function MergeDialog({
	open,
	onOpenChange,
	target,
	source = null,
	defaultReveal,
	onMerged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	target: MergeSide;
	/** A preset source (a proposal); otherwise the reader picks a subject. */
	source?: MergeSide | null;
	/** The default reveal unit's end position; null uses the reading position or later first appearance. */
	defaultReveal?: number | null;
	onMerged?: (ref: string) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				{open && (
					<MergeForm
						target={target}
						source={source}
						defaultReveal={defaultReveal ?? null}
						onDone={(ref) => {
							onOpenChange(false);
							onMerged?.(ref);
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function MergeForm({
	target,
	source: preset,
	defaultReveal,
	onDone,
}: {
	target: MergeSide;
	source: MergeSide | null;
	defaultReveal: number | null;
	onDone: (ref: string) => void;
}) {
	const { editionId, bound, units, position } = useGuide();
	const id = useId();
	const merge = useServerFn(mergeSubjectsFn);
	const { run, busy, error } = useSubjectEdit();
	const subjects = useQuery({
		queryKey: ["guide", editionId, "subjects", bound ? boundKey(bound) : null],
		queryFn: () =>
			listGuideSubjectsFn({
				data: { editionId, bound: bound?.choice ?? { kind: "whole" } },
			}),
		enabled: preset === null && bound !== null,
	});
	const others =
		subjects.data?.ok === true
			? subjects.data.subjects.filter((s) => s.ref !== target.ref)
			: [];
	const [sourceRef, setSourceRef] = useState(preset?.ref ?? "");
	const source =
		preset ??
		(() => {
			const s = others.find((o) => o.ref === sourceRef);
			return s
				? { ref: s.ref, name: s.name, firstPosition: s.firstPosition }
				: null;
		})();

	// The reading position, or the later first appearance when it is unset.
	const atPosition =
		position?.kind === "unit" &&
		units.some((u) => u.endPosition === position.maxPosition)
			? position.maxPosition
			: null;
	const fallback = source
		? Math.max(target.firstPosition, source.firstPosition)
		: target.firstPosition;
	const suggested = defaultReveal ?? atPosition ?? fallback;
	const [chosen, setChosen] = useState<number | null>(null);
	const reveal = chosen ?? suggested;
	const revealUnit = units.find((u) => u.endPosition === reveal);
	const [passage, setPassage] = useState("");
	const locator = passageLocator(passage);

	const submit = async () => {
		if (!source) return;
		const ref = await run((input) =>
			merge({
				data: {
					...input,
					targetRef: target.ref,
					sourceRef: source.ref,
					reveal: locator
						? { kind: "passage", locator }
						: { kind: "unit", endPosition: reveal },
				},
			}),
		);
		if (ref) onDone(ref);
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{source
						? `Merge “${source.name}” into “${target.name}”?`
						: `Merge a subject into “${target.name}”`}
				</DialogTitle>
				<DialogDescription>
					From the reveal on, both names read as one subject in the Guide,
					margin glosses and the assistant. Before it they stay separate. The
					names' notes and kinds are not changed.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4 text-sm">
				{preset === null && (
					<label className="grid gap-1" htmlFor={`${id}-source`}>
						<span className="font-medium">Subject to merge in</span>
						<select
							id={`${id}-source`}
							className={selectClass}
							value={sourceRef}
							onChange={(e) => setSourceRef(e.currentTarget.value)}
							disabled={subjects.isPending}
						>
							<option value="">
								{subjects.isPending ? "Loading…" : "Choose a subject"}
							</option>
							{others.map((s) => (
								<option key={s.ref} value={s.ref}>
									{s.name} ({KIND_LABELS[s.kind].singular.toLowerCase()})
								</option>
							))}
						</select>
					</label>
				)}
				<label className="grid gap-1" htmlFor={`${id}-reveal`}>
					<span className="font-medium">Revealed in</span>
					<select
						id={`${id}-reveal`}
						className={selectClass}
						value={reveal}
						onChange={(e) => setChosen(Number(e.currentTarget.value))}
						disabled={locator !== null}
						data-testid="merge-reveal"
					>
						{units.map((u) => (
							<option key={u.endPosition} value={u.endPosition}>
								{u.label}
							</option>
						))}
					</select>
					<span className="text-xs text-muted-foreground">
						{defaultReveal === null && atPosition !== null
							? "Defaults to your reading position."
							: "Defaults to where the later of the two names first appears."}
					</span>
				</label>
				<label className="grid gap-1" htmlFor={`${id}-passage`}>
					<span className="font-medium">
						Or a specific passage{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</span>
					<Input
						id={`${id}-passage`}
						value={passage}
						onChange={(e) => setPassage(e.currentTarget.value)}
						placeholder="Paste a passage link from the reader"
					/>
				</label>
				<p
					className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
					data-testid="merge-spoiler-warning"
				>
					<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
					<span>
						If the book only reveals that these are the same{" "}
						{locator
							? "later than that passage"
							: `after ${revealUnit?.label ?? "this chapter"}`}
						, merging here will spoil it for anyone reading up to there. Choose
						the chapter or passage where the identity is actually revealed.
					</span>
				</p>
				{error && (
					<p role="alert" className="text-sm text-destructive-foreground">
						{error}
					</p>
				)}
			</div>
			<DialogFooter>
				<DialogClose asChild>
					<Button variant="outline" disabled={busy}>
						Cancel
					</Button>
				</DialogClose>
				<Button onClick={submit} disabled={busy || !source}>
					<Merge aria-hidden />
					{busy ? "Merging…" : "Merge"}
				</Button>
			</DialogFooter>
		</>
	);
}

/**
 * Merges proposed among the names observed within the bound: each can be
 * reviewed in the merge dialog or dismissed for good. Nothing changes until
 * the reader confirms.
 */
export function ProposalList() {
	const { editionId, bound, preprocessed } = useGuide();
	const queryClient = useQueryClient();
	const dismiss = useServerFn(dismissProposalFn);
	const proposals = useQuery({
		queryKey: ["guide", editionId, "proposals", bound ? boundKey(bound) : null],
		queryFn: () =>
			listGuideProposalsFn({
				data: { editionId, bound: bound?.choice ?? { kind: "whole" } },
			}),
		enabled: preprocessed && bound !== null,
	});
	const [reviewing, setReviewing] = useState<MergeProposal | null>(null);
	const [expanded, setExpanded] = useState(false);
	const list = proposals.data?.ok ? proposals.data.proposals : [];
	if (list.length === 0) return null;
	const shown = expanded ? list : list.slice(0, 3);
	const side = (p: MergeProposal["primary"]): MergeSide => ({
		ref: p.ref,
		name: p.name,
		firstPosition: 0,
	});

	return (
		<section
			aria-label="Suggested merges"
			className="mt-4 rounded-md border bg-muted/30 p-3"
			data-testid="guide-proposals"
		>
			<h2 className="text-sm font-medium">Possibly the same</h2>
			<p className="text-xs text-muted-foreground">
				Suggested from the names alone. Nothing is merged until you confirm.
			</p>
			<ul className="mt-2 space-y-1">
				{shown.map((p) => (
					<li
						key={`${p.primary.key}\n${p.alias.key}`}
						className="flex flex-wrap items-center gap-2 text-sm"
						data-testid="guide-proposal"
					>
						<span className="flex-1">
							“{p.alias.name}” and “{p.primary.name}”
							<span className="text-xs text-muted-foreground">
								{" "}
								· {KIND_LABELS[p.kind].plural.toLowerCase()}
							</span>
						</span>
						<Button size="xs" variant="outline" onClick={() => setReviewing(p)}>
							<Merge aria-hidden />
							Merge…
						</Button>
						<Button
							size="xs"
							variant="ghost"
							aria-label={`Dismiss “${p.alias.name}” and “${p.primary.name}”`}
							onClick={async () => {
								await dismiss({
									data: { editionId, keys: [p.primary.key, p.alias.key] },
								});
								await queryClient.invalidateQueries({
									queryKey: ["guide", editionId, "proposals"],
								});
							}}
						>
							<X aria-hidden />
							Dismiss
						</Button>
					</li>
				))}
			</ul>
			{list.length > shown.length && (
				<Button
					size="xs"
					variant="link"
					className="mt-1 px-0"
					onClick={() => setExpanded(true)}
				>
					Show all {list.length}
				</Button>
			)}
			{reviewing && (
				<MergeDialog
					open
					onOpenChange={(open) => !open && setReviewing(null)}
					target={side(reviewing.primary)}
					source={side(reviewing.alias)}
					defaultReveal={reviewing.reveal.endPosition}
				/>
			)}
		</section>
	);
}

/**
 * The reader's edits on a subject's page: its display name, its kind, its
 * names (each can be split out), and merging another subject into it.
 */
export function SubjectEditor({
	subject,
	onRefChange,
}: {
	subject: SubjectTimeline;
	/** Called with the subject's ref after an edit that changed it. */
	onRefChange: (ref: string) => void;
}) {
	const id = useId();
	const rename = useServerFn(renameSubjectFn);
	const setKind = useServerFn(setSubjectKindFn);
	const split = useServerFn(splitSubjectFn);
	const { run, busy, error } = useSubjectEdit();
	const [merging, setMerging] = useState(false);
	const linked = subject.ref.startsWith("s:") && subject.names.length > 1;
	const displayKey =
		subject.names.find((n) => n.name === subject.name)?.key ?? "";
	const after = (ref: string | null) => {
		if (ref && ref !== subject.ref) onRefChange(ref);
	};

	return (
		<section
			aria-label="Edit subject"
			className="mt-4 space-y-3 rounded-md border p-3 text-sm"
			data-testid="subject-editor"
		>
			<div className="flex flex-wrap items-end gap-3">
				{linked && (
					<label className="grid gap-1" htmlFor={`${id}-name`}>
						<span className="text-xs font-medium">Shown as</span>
						<select
							id={`${id}-name`}
							className={selectClass}
							value={displayKey}
							disabled={busy}
							onChange={async (e) => {
								const key = e.currentTarget.value;
								after(
									await run((input) =>
										rename({
											data: { ...input, ref: subject.ref, displayKey: key },
										}),
									),
								);
							}}
						>
							{subject.names.map((n) => (
								<option key={n.key} value={n.key}>
									{n.name}
								</option>
							))}
						</select>
					</label>
				)}
				<label className="grid gap-1" htmlFor={`${id}-kind`}>
					<span className="text-xs font-medium">Kind</span>
					<select
						id={`${id}-kind`}
						className={selectClass}
						value={subject.readerKind ?? ""}
						disabled={busy}
						onChange={async (e) => {
							const kind = (e.currentTarget.value ||
								null) as ObservationKind | null;
							after(
								await run((input) =>
									setKind({ data: { ...input, ref: subject.ref, kind } }),
								),
							);
						}}
					>
						<option value="">
							As observed
							{subject.readerKind
								? ""
								: ` (${KIND_LABELS[subject.kind].singular.toLowerCase()})`}
						</option>
						{KINDS.map((k) => (
							<option key={k} value={k}>
								{KIND_LABELS[k].singular}
							</option>
						))}
					</select>
				</label>
				<Button
					size="sm"
					variant="outline"
					onClick={() => setMerging(true)}
					disabled={busy}
				>
					<Merge aria-hidden />
					Merge another subject in…
				</Button>
			</div>
			{linked && (
				<div>
					<p className="text-xs font-medium">Names</p>
					<ul className="mt-1 flex flex-wrap gap-2">
						{subject.names.map((n) => (
							<li
								key={n.key}
								className="flex items-center gap-1 rounded-md border px-2 py-0.5"
								data-testid="subject-name"
							>
								{n.name}
								<Button
									size="icon-xs"
									variant="ghost"
									aria-label={`Split “${n.name}” out`}
									title="Split this name out into its own subject"
									disabled={busy}
									onClick={async () =>
										after(
											await run((input) =>
												split({
													data: { ...input, ref: subject.ref, nameKey: n.key },
												}),
											),
										)
									}
								>
									<Split aria-hidden />
								</Button>
							</li>
						))}
					</ul>
				</div>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive-foreground">
					{error}
				</p>
			)}
			<MergeDialog
				open={merging}
				onOpenChange={setMerging}
				target={{
					ref: subject.ref,
					name: subject.name,
					firstPosition: subject.entries[0]?.endPosition ?? 0,
				}}
				onMerged={after}
			/>
		</section>
	);
}
