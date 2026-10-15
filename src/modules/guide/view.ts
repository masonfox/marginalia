import { and, eq, inArray } from "drizzle-orm";
import {
	type DerivedCitation,
	getPreprocessStatus,
	hasCurrentPreprocessing,
} from "#/modules/analysis";
import { passages } from "#/modules/catalog";
import { editions } from "#/modules/library";
import type { Executor } from "#/server/db";
import { listCorrections } from "./corrections";
import {
	defaultNoteAnchor,
	getNote,
	listNotes,
	listSubjectNotes,
	type NoteAnchorChoice,
	type ReaderNote,
} from "./notes";
import {
	getReadingPosition,
	type PositionChoice,
	type ReadingPosition,
} from "./position";
import {
	type CorrectionMark,
	type GuideSubjectEntry,
	getMergedObservations,
	getMergedSummaries,
	getSubjectTimeline,
	getUnitAnchors,
	listProposals,
	listSubjects,
	resolveSubjects,
	type SubjectTimeline,
	type UnitAnchors,
} from "./queries";
import type { CorrectionAction, CorrectionTarget } from "./schema";
import type { MergeProposal, SubjectResolution } from "./subjects";

/** The bound a Guide visit reads at: a reading unit by its end position, or the whole book. */
export type GuideBoundChoice = PositionChoice;

/**
 * A Guide read, or why it was refused. `not_found`: the edition is missing
 * or not ready. `stale_bound`: the bound is not one of the edition's current
 * units (choose again).
 */
export type GuideResult<T> =
	| ({ ok: true } & T)
	| { ok: false; reason: "not_found" | "stale_bound" };

interface Bound {
	/** Null for the whole book. */
	bound: number | null;
	/** The unit's label; null for the whole book. */
	label: string | null;
	anchors: UnitAnchors;
}

/**
 * Validates a requested bound against the ready edition's current reading
 * units, the way scopes are: a unit bound must be a current unit's end.
 */
async function resolveBound(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
): Promise<Bound | { reason: "not_found" | "stale_bound" }> {
	const [edition] = await db
		.select({ status: editions.status })
		.from(editions)
		.where(eq(editions.id, editionId));
	if (!edition || edition.status !== "ready") return { reason: "not_found" };
	const anchors = await getUnitAnchors(db, editionId);
	if (choice.kind === "whole") return { bound: null, label: null, anchors };
	const unit = anchors.units.find((u) => u.endPosition === choice.endPosition);
	if (!unit) return { reason: "stale_bound" };
	return { bound: unit.endPosition, label: unit.label, anchors };
}

/** Runs `read` at a validated bound. */
async function atBound<T>(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
	read: (bound: Bound) => Promise<T>,
): Promise<GuideResult<T>> {
	const bound = await resolveBound(db, editionId, choice);
	if ("reason" in bound) return { ok: false, reason: bound.reason };
	return { ok: true, ...(await read(bound)) };
}

export interface GuideOverview {
	edition: { id: string; title: string; status: string };
	/** The reading position, the visit bound's default; null when unset. */
	position: ReadingPosition | null;
	/** Whether any current preprocessing exists; without it the Guide has no derived data. */
	preprocessed: boolean;
}

/** What the Guide needs before choosing a bound. Null when the edition does not exist. */
export async function getGuideOverview(
	db: Executor,
	editionId: string,
): Promise<GuideOverview | null> {
	const [edition] = await db
		.select({ id: editions.id, title: editions.title, status: editions.status })
		.from(editions)
		.where(eq(editions.id, editionId));
	if (!edition) return null;
	const [position, preprocessed] = await Promise.all([
		getReadingPosition(db, editionId),
		hasCurrentPreprocessing(db, editionId),
	]);
	return { edition, position, preprocessed };
}

/** A reading unit in the Chapters view, with its summary or null when not yet summarized. */
export interface GuideChapter {
	ordinal: number;
	label: string;
	locator: string;
	endPosition: number;
	summary: {
		text: string;
		citations: DerivedCitation[];
		/**
		 * The reader's correction, or null. A summary the reader suppressed
		 * keeps its generated text here, for "show hidden" and restore.
		 */
		correction: CorrectionMark | null;
	} | null;
	/** The reader's notes attached to the unit and visible at the bound. */
	notes: GuideNote[];
}

/**
 * Every reading unit ending at or before the bound, in reading order, with
 * its merged summary and its attached notes. Suppressed summaries are
 * included, marked, so the Guide can list them behind "show hidden".
 */
export async function getGuideChapters(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
): Promise<GuideResult<{ chapters: GuideChapter[] }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => {
		const [summaries, attached] = await Promise.all([
			getMergedSummaries(db, editionId, bound, anchors, {
				includeHidden: true,
			}),
			listNotes(db, editionId, bound, { kind: "unit" }),
		]);
		const byOrdinal = new Map(summaries.map((s) => [s.unitOrdinal, s]));
		const notesOf = new Map<string, GuideNote[]>();
		for (const note of await describeNotes(
			db,
			editionId,
			bound,
			anchors,
			attached,
		)) {
			if (!note.unit) continue;
			notesOf.set(note.unit.locator, [
				...(notesOf.get(note.unit.locator) ?? []),
				note,
			]);
		}
		const chapters = anchors.units
			.filter((u) => bound === null || u.endPosition <= bound)
			.map((u) => {
				const s = byOrdinal.get(u.ordinal);
				return {
					ordinal: u.ordinal,
					label: u.label,
					locator: u.startLocator,
					endPosition: u.endPosition,
					summary: s
						? {
								text: s.summary,
								citations: s.citations,
								correction: s.correction,
							}
						: null,
					notes: notesOf.get(u.startLocator) ?? [],
				};
			});
		return { chapters };
	});
}

/** The Index at the bound; with `includeHidden`, subjects the reader suppressed entirely too. */
export async function listGuideSubjects(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
	{ includeHidden = false }: { includeHidden?: boolean } = {},
): Promise<GuideResult<{ subjects: GuideSubjectEntry[] }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => ({
		subjects: await listSubjects(db, editionId, bound, anchors, {
			includeHidden,
		}),
	}));
}

/** Merges proposed among the names visible at the bound. */
export async function listGuideProposals(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
): Promise<GuideResult<{ proposals: MergeProposal[] }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => ({
		proposals: await listProposals(db, editionId, bound, anchors),
	}));
}

/**
 * A subject's timeline at the bound, with the notes attached to it there;
 * `subject` is null when it has nothing within the bound. Suppressed
 * observations are included, marked, for "show hidden".
 */
export async function getGuideSubject(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
	ref: string,
): Promise<
	GuideResult<{ subject: (SubjectTimeline & { notes: GuideNote[] }) | null }>
> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => {
		const timeline = await getSubjectTimeline(
			db,
			editionId,
			ref,
			bound,
			anchors,
			{ includeHidden: true },
		);
		if (!timeline) return { subject: null };
		const resolution = await resolveSubjects(db, editionId, bound, anchors);
		const notes = await listSubjectNotes(db, editionId, ref, bound, resolution);
		return {
			subject: {
				...timeline,
				notes: await describeNotes(
					db,
					editionId,
					bound,
					anchors,
					notes,
					resolution,
				),
			},
		};
	});
}

/**
 * Where the derived data came from. `current`: every unit has a current
 * summary. `partial`: some units have none. `stale`: rows from an older
 * structure or prompt remain, waiting to be regenerated.
 */
export interface GuideProvenance {
	/** Models of the summaries within the bound. */
	models: string[];
	/** Prompt versions of the summaries within the bound. */
	promptVersions: number[];
	state: "current" | "partial" | "stale";
}

/** Provenance of the merged summaries at the bound, and the edition's preprocessing state. */
export async function getGuideProvenance(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
): Promise<GuideResult<{ provenance: GuideProvenance }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => {
		const [all, status] = await Promise.all([
			// A summary the reader suppressed was still generated.
			getMergedSummaries(db, editionId, null, anchors, { includeHidden: true }),
			getPreprocessStatus(db, editionId),
		]);
		const shown = all.filter((s) => bound === null || s.endPosition <= bound);
		const distinct = <T>(values: T[]) => [...new Set(values)];
		return {
			provenance: {
				models: distinct(shown.map((s) => s.model)).sort(),
				promptVersions: distinct(shown.map((s) => s.promptVersion)).sort(
					(a, b) => a - b,
				),
				state:
					status.status === "stale"
						? "stale"
						: all.length < anchors.units.length
							? "partial"
							: "current",
			},
		};
	});
}

/** A correction whose machine row was regenerated since: the reader keeps or drops it. */
export interface RegeneratedCorrection {
	id: number;
	target: CorrectionTarget;
	action: CorrectionAction;
	unitLabel: string;
	unitLocator: string;
	/** The observed name, for an observation; null for a summary. */
	name: string | null;
	nameKey: string | null;
	/** The reader's text; null when they suppressed the row. */
	text: string | null;
	/** The regenerated machine text. */
	generated: string;
}

/** A correction that applies nowhere since a reparse moved its unit's boundary. */
export interface DetachedCorrection {
	id: number;
	target: CorrectionTarget;
	action: CorrectionAction;
	nameKey: string | null;
	text: string | null;
	/** The current unit holding the passage it was anchored to; null when none does. */
	unitLabel: string | null;
}

export interface CorrectionReview {
	regenerated: RegeneratedCorrection[];
	detached: DetachedCorrection[];
}

/**
 * The reader's corrections that need review at the bound: those whose
 * machine row was regenerated since, and those a reparse detached. Both are
 * bounded like what they correct: a detached correction is listed once the
 * unit now holding its anchor passage ends within the bound, and only for
 * the whole book when no current unit holds it.
 */
export async function getCorrectionReview(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
): Promise<GuideResult<{ review: CorrectionReview }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => {
		const hidden = { includeHidden: true };
		const [summaries, observations, all] = await Promise.all([
			getMergedSummaries(db, editionId, bound, anchors, hidden),
			getMergedObservations(db, editionId, bound, anchors, undefined, hidden),
			listCorrections(db, editionId),
		]);
		const texts = new Map(all.map((c) => [c.id, c.text]));
		const regenerated: RegeneratedCorrection[] = [];
		const seen = new Set<number>();
		const flag = (
			row: { unitLabel: string; unitLocator: string },
			c: CorrectionMark | null,
			observed: { name: string; nameKey: string } | null,
		) => {
			if (!c?.regeneratedSince || seen.has(c.id)) return;
			seen.add(c.id);
			regenerated.push({
				id: c.id,
				target: observed ? "observation" : "summary",
				action: c.action,
				unitLabel: row.unitLabel,
				unitLocator: row.unitLocator,
				name: observed?.name ?? null,
				nameKey: observed?.nameKey ?? null,
				text: texts.get(c.id) ?? null,
				generated: c.generated,
			});
		};
		for (const s of summaries) flag(s, s.correction, null);
		for (const o of observations) flag(o, o.correction, o);

		const detachedRows = all.filter((c) => c.detached);
		const located =
			detachedRows.length === 0
				? []
				: await db
						.select({ locator: passages.locator, position: passages.position })
						.from(passages)
						.where(
							and(
								eq(passages.editionId, editionId),
								inArray(
									passages.locator,
									detachedRows.map((c) => c.unitLocator),
								),
							),
						);
		const positionOf = new Map(located.map((p) => [p.locator, p.position]));
		const detached = detachedRows.flatMap((c) => {
			const position = positionOf.get(c.unitLocator) ?? null;
			const unit =
				position === null
					? undefined
					: anchors.units.find(
							(u) => u.startPosition <= position && position <= u.endPosition,
						);
			if (bound !== null && (!unit || unit.endPosition > bound)) return [];
			return [
				{
					id: c.id,
					target: c.target,
					action: c.action,
					nameKey: c.nameKey,
					text: c.text,
					unitLabel: unit?.label ?? null,
				},
			];
		});
		return { review: { regenerated, detached } };
	});
}

/** A reader note as the Guide shows it at a bound. */
export interface GuideNote extends ReaderNote {
	/**
	 * The attached subject as it resolves at the bound, or null when the note
	 * is not attached to one. `name` is null when none of its names has
	 * appeared within the bound, so it has no timeline there.
	 */
	subject: { key: string; ref: string; name: string | null } | null;
	/** The attached unit, or null when the note is not attached to one. */
	unit: { locator: string; label: string } | null;
}

/** Describes notes at a bound: their subject's ref and name there, and their unit's label. */
async function describeNotes(
	db: Executor,
	editionId: string,
	bound: number | null,
	anchors: UnitAnchors,
	notes: ReaderNote[],
	known?: SubjectResolution,
): Promise<GuideNote[]> {
	const resolution =
		known ??
		(notes.some((n) => n.subjectKey !== null)
			? await resolveSubjects(db, editionId, bound, anchors)
			: null);
	return notes.map((note) => {
		const ref =
			note.subjectKey !== null && resolution
				? resolution.refOf(note.subjectKey)
				: null;
		const unit =
			note.unitLocator !== null ? anchors.unitAt(note.unitLocator) : null;
		return {
			...note,
			subject:
				ref !== null && note.subjectKey !== null
					? {
							key: note.subjectKey,
							ref,
							name: resolution?.nameOf(ref) ?? null,
						}
					: null,
			unit: unit ? { locator: unit.startLocator, label: unit.label } : null,
		};
	});
}

/** The Notes view: every note visible at the bound. */
export async function listGuideNotes(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
): Promise<GuideResult<{ notes: GuideNote[] }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => ({
		notes: await describeNotes(
			db,
			editionId,
			bound,
			anchors,
			await listNotes(db, editionId, bound),
		),
	}));
}

/** One note, or null when it does not exist or is not visible at the bound. */
export async function getGuideNote(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
	id: number,
): Promise<GuideResult<{ note: GuideNote | null }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => {
		const note = await getNote(db, editionId, id, bound);
		if (!note) return { note: null };
		const [described] = await describeNotes(db, editionId, bound, anchors, [
			note,
		]);
		return { note: described ?? null };
	});
}

/**
 * What a new note starts from: the anchor it defaults to (the reading
 * position, or the end of the book once finished), or null when the reader
 * must choose. Null when the edition is missing or not ready.
 */
export async function getNoteDefaults(
	db: Executor,
	editionId: string,
): Promise<{
	anchor: { choice: NoteAnchorChoice; label: string | null } | null;
} | null> {
	const [edition] = await db
		.select({ status: editions.status })
		.from(editions)
		.where(eq(editions.id, editionId));
	if (!edition || edition.status !== "ready") return null;
	return { anchor: await defaultNoteAnchor(db, editionId) };
}
