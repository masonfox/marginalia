import { eq } from "drizzle-orm";
import {
	type DerivedCitation,
	getPreprocessStatus,
	hasCurrentPreprocessing,
} from "#/modules/analysis";
import { editions } from "#/modules/library";
import type { Executor } from "#/server/db";
import {
	getReadingPosition,
	type PositionChoice,
	type ReadingPosition,
} from "./position";
import {
	type GuideSubjectEntry,
	getMergedSummaries,
	getSubjectTimeline,
	getUnitAnchors,
	listProposals,
	listSubjects,
	type SubjectTimeline,
	type UnitAnchors,
} from "./queries";
import type { MergeProposal } from "./subjects";

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
	summary: { text: string; citations: DerivedCitation[] } | null;
}

/** Every reading unit ending at or before the bound, in reading order, with its merged summary. */
export async function getGuideChapters(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
): Promise<GuideResult<{ chapters: GuideChapter[] }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => {
		const summaries = await getMergedSummaries(db, editionId, bound, anchors);
		const byOrdinal = new Map(summaries.map((s) => [s.unitOrdinal, s]));
		const chapters = anchors.units
			.filter((u) => bound === null || u.endPosition <= bound)
			.map((u) => {
				const s = byOrdinal.get(u.ordinal);
				return {
					ordinal: u.ordinal,
					label: u.label,
					locator: u.startLocator,
					endPosition: u.endPosition,
					summary: s ? { text: s.summary, citations: s.citations } : null,
				};
			});
		return { chapters };
	});
}

/** The Index at the bound. */
export async function listGuideSubjects(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
): Promise<GuideResult<{ subjects: GuideSubjectEntry[] }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => ({
		subjects: await listSubjects(db, editionId, bound, anchors),
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

/** A subject's timeline at the bound; `subject` is null when it has nothing within the bound. */
export async function getGuideSubject(
	db: Executor,
	editionId: string,
	choice: GuideBoundChoice,
	ref: string,
): Promise<GuideResult<{ subject: SubjectTimeline | null }>> {
	return atBound(db, editionId, choice, async ({ bound, anchors }) => ({
		subject: await getSubjectTimeline(db, editionId, ref, bound, anchors),
	}));
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
			getMergedSummaries(db, editionId, null, anchors),
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
