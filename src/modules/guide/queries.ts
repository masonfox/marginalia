import { eq } from "drizzle-orm";
import {
	type DerivedCitation,
	listObservations,
	listObservedNames,
	listSummaries,
	type ObservationKind,
} from "#/modules/analysis";
import { getReadingUnits, type ReadingUnit } from "#/modules/catalog";
import type { Executor } from "#/server/db";
import {
	type CorrectionRecord,
	correctionKey,
	fingerprintOf,
	loadCorrections,
	observationText,
} from "./corrections";
import {
	type CorrectionAction,
	guideDismissedProposals,
	guideSubjectAliases,
	guideSubjects,
} from "./schema";
import {
	type AliasLink,
	type Appearance,
	buildResolution,
	type MergeProposal,
	proposeMerges,
	type SubjectName,
	type SubjectRecord,
	type SubjectResolution,
} from "./subjects";

/** A machine row's unit identity: summaries and observations both carry it. */
export interface UnitRowKey {
	unitOrdinal: number;
	endPosition: number;
}

/**
 * An edition's current reading units, keyed for the merged view (design D4):
 * a unit's anchor is the locator of its first passage.
 */
export interface UnitAnchors {
	units: ReadingUnit[];
	/** The start locator of the unit at `ordinal`, or null when there is none. */
	locatorOf(ordinal: number): string | null;
	/** The unit whose first passage is `locator`, or null when it starts none. */
	unitAt(locator: string): ReadingUnit | null;
	/**
	 * The current unit a machine row describes, or null when the row's end
	 * position no longer matches the derived unit at its ordinal.
	 */
	unitOf(row: UnitRowKey): ReadingUnit | null;
}

/** Derives the edition's reading units once and indexes them by ordinal and start locator. */
export async function getUnitAnchors(
	db: Executor,
	editionId: string,
): Promise<UnitAnchors> {
	const units = await getReadingUnits(db, editionId);
	const byLocator = new Map(units.map((u) => [u.startLocator, u]));
	const at = (ordinal: number) => units[ordinal] ?? null;
	return {
		units,
		locatorOf: (ordinal) => at(ordinal)?.startLocator ?? null,
		unitAt: (locator) => byLocator.get(locator) ?? null,
		unitOf: (row) => {
			const unit = at(row.unitOrdinal);
			return unit?.endPosition === row.endPosition ? unit : null;
		},
	};
}

/**
 * Memoizes getUnitAnchors per edition for one request, so the Guide, glosses
 * and the assistant derive each edition's units at most once per call.
 */
export function unitAnchorsCache(
	db: Executor,
): (editionId: string) => Promise<UnitAnchors> {
	const cache = new Map<string, Promise<UnitAnchors>>();
	return (editionId) => {
		let anchors = cache.get(editionId);
		if (!anchors) {
			anchors = getUnitAnchors(db, editionId);
			// A failed derivation is retried by the next caller.
			anchors.catch(() => cache.delete(editionId));
			cache.set(editionId, anchors);
		}
		return anchors;
	};
}

/** A machine row placed in the current structure (design D4). */
interface Placed {
	unitOrdinal: number;
	/** The current unit's label. */
	unitLabel: string;
	/** The unit's anchor: the locator of its first passage. */
	unitLocator: string;
	endPosition: number;
}

/** A unit summary in the merged view. */
export interface GuideSummary extends Placed {
	summary: string;
	citations: DerivedCitation[];
	model: string;
	promptVersion: number;
	/** The reader's correction applied to it, or null. */
	correction: CorrectionMark | null;
}

/** An observation in the merged view. */
export interface GuideObservation extends Placed {
	name: string;
	nameKey: string;
	kind: ObservationKind;
	note: string;
	citations: DerivedCitation[];
	/** The reader's correction applied to it, or null. */
	correction: CorrectionMark | null;
}

/** One observed name in one unit, placed: the Index's grain. */
interface GuideObservedName extends Placed {
	name: string;
	nameKey: string;
	kinds: ObservationKind[];
	/** Suppressed by the reader: listed only when hidden rows are asked for. */
	hidden: boolean;
}

/** Places machine rows in the current units, dropping rows that match none. */
function place<T extends UnitRowKey>(
	anchors: UnitAnchors,
	rows: T[],
): (T & Placed)[] {
	return rows.flatMap((row) => {
		const unit = anchors.unitOf(row);
		if (!unit) return [];
		return [{ ...row, unitLabel: unit.label, unitLocator: unit.startLocator }];
	});
}

/** How a reader correction applies to a merged row. */
export interface CorrectionMark {
	id: number;
	action: CorrectionAction;
	/**
	 * The machine text was regenerated since the reader's correction: it no
	 * longer matches the fingerprint they acknowledged.
	 */
	regeneratedSince: boolean;
	/** The current machine text the correction covers. */
	generated: string;
}

/** Merge options: `includeHidden` keeps suppressed rows, marked, for "show hidden". */
export interface MergeOptions {
	includeHidden?: boolean;
}

/** The mark of a correction over the current machine text it covers. */
const markOf = (c: CorrectionRecord, generated: string): CorrectionMark => ({
	id: c.id,
	action: c.action,
	regeneratedSince: fingerprintOf(generated) !== c.fingerprint,
	generated,
});

/**
 * Applies the edition's reader corrections to placed summaries (design D5).
 * A correction matches a current row by its unit anchor: a replaced row
 * carries the reader's text and only their citation, a suppressed row is
 * dropped. A correction with no current row has no effect, so it follows
 * the row's bound and staleness and applies again once the row is
 * regenerated.
 */
async function mergeSummaryCorrections<
	T extends Placed & { summary: string; citations: DerivedCitation[] },
>(
	db: Executor,
	editionId: string,
	rows: T[],
	{ includeHidden = false }: MergeOptions,
): Promise<(T & { correction: CorrectionMark | null })[]> {
	const corrections = await loadCorrections(db, editionId, "summary");
	return rows.flatMap((row): (T & { correction: CorrectionMark | null })[] => {
		const c = corrections.get(correctionKey(row.unitLocator, null));
		if (!c) return [{ ...row, correction: null }];
		const correction = markOf(c, row.summary);
		if (c.action === "suppress")
			return includeHidden ? [{ ...row, correction }] : [];
		return [
			{
				...row,
				summary: c.text ?? row.summary,
				citations: c.citation ? [c.citation] : [],
				correction,
			},
		];
	});
}

/**
 * Applies the edition's reader corrections to placed observations. A
 * correction covers every current observation of its name key in its unit:
 * replaced, they read as one row with the reader's text and citation, in
 * the place of the first; suppressed, they are dropped.
 */
async function mergeObservationCorrections<
	T extends Placed & {
		nameKey: string;
		note: string;
		citations: DerivedCitation[];
	},
>(
	db: Executor,
	editionId: string,
	rows: T[],
	{ includeHidden = false }: MergeOptions,
): Promise<(T & { correction: CorrectionMark | null })[]> {
	const corrections = await loadCorrections(db, editionId, "observation");
	if (corrections.size === 0)
		return rows.map((r) => ({ ...r, correction: null }));
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const key = correctionKey(row.unitLocator, row.nameKey);
		if (!corrections.has(key)) continue;
		groups.set(key, [...(groups.get(key) ?? []), row]);
	}
	const merged: (T & { correction: CorrectionMark | null })[] = [];
	const done = new Set<string>();
	for (const row of rows) {
		const key = correctionKey(row.unitLocator, row.nameKey);
		const c = corrections.get(key);
		if (!c) {
			merged.push({ ...row, correction: null });
			continue;
		}
		if (done.has(key)) continue;
		done.add(key);
		const group = groups.get(key) ?? [row];
		const correction = markOf(c, observationText(group.map((r) => r.note)));
		if (c.action === "suppress") {
			if (includeHidden)
				merged.push(...group.map((r) => ({ ...r, correction })));
			continue;
		}
		merged.push({
			...row,
			note: c.text ?? row.note,
			citations: c.citation ? [c.citation] : [],
			correction,
		});
	}
	return merged;
}

/**
 * The merged summaries of units ending at or before `bound` (null: whole
 * book), in reading order: current machine rows of current units, with
 * reader corrections applied.
 */
export async function getMergedSummaries(
	db: Executor,
	editionId: string,
	bound: number | null,
	anchors: UnitAnchors,
	options: MergeOptions = {},
): Promise<GuideSummary[]> {
	const rows = place(anchors, await listSummaries(db, editionId, bound));
	return mergeSummaryCorrections(db, editionId, rows, options);
}

/**
 * The merged observations of units ending at or before `bound` (null: whole
 * book), in reading order, optionally only those of `nameKeys`.
 */
export async function getMergedObservations(
	db: Executor,
	editionId: string,
	bound: number | null,
	anchors: UnitAnchors,
	nameKeys?: string[],
	options: MergeOptions = {},
): Promise<GuideObservation[]> {
	const rows = place(
		anchors,
		await listObservations(db, editionId, bound, nameKeys),
	);
	return mergeObservationCorrections(db, editionId, rows, options);
}

/**
 * Observed names per unit at a bound, merged like observations: a name
 * whose observations in a unit are suppressed is not observed there, or is
 * marked hidden with `includeHidden`.
 */
async function getMergedObservedNames(
	db: Executor,
	editionId: string,
	bound: number | null,
	anchors: UnitAnchors,
	{ includeHidden = false }: MergeOptions = {},
): Promise<GuideObservedName[]> {
	const [rows, corrections] = await Promise.all([
		listObservedNames(db, editionId, bound),
		loadCorrections(db, editionId, "observation"),
	]);
	return place(anchors, rows).flatMap((row) => {
		const c = corrections.get(correctionKey(row.unitLocator, row.nameKey));
		const hidden = c?.action === "suppress";
		return hidden && !includeHidden ? [] : [{ ...row, hidden }];
	});
}

/** The edition's confirmed subjects and their alias links. */
export async function loadSubjectLinks(
	db: Executor,
	editionId: string,
): Promise<{ subjects: SubjectRecord[]; links: AliasLink[] }> {
	const [subjects, links] = await Promise.all([
		db
			.select({
				id: guideSubjects.id,
				displayKey: guideSubjects.displayKey,
				kind: guideSubjects.kind,
			})
			.from(guideSubjects)
			.where(eq(guideSubjects.editionId, editionId)),
		db
			.select({
				nameKey: guideSubjectAliases.nameKey,
				subjectId: guideSubjectAliases.subjectId,
				isPrimary: guideSubjectAliases.isPrimary,
				revealLocator: guideSubjectAliases.revealLocator,
				revealPosition: guideSubjectAliases.revealPosition,
			})
			.from(guideSubjectAliases)
			.where(eq(guideSubjectAliases.editionId, editionId)),
	]);
	return { subjects, links };
}

/** Each name's first appearance among observed names in reading order. */
function firstAppearances(rows: GuideObservedName[]): Map<string, Appearance> {
	const appearances = new Map<string, Appearance>();
	for (const row of rows) {
		if (appearances.has(row.nameKey)) continue;
		appearances.set(row.nameKey, {
			name: row.name,
			position: row.endPosition,
			unitLabel: row.unitLabel,
		});
	}
	return appearances;
}

/** The names observed within a bound, and how they group into subjects there. */
async function subjectsAt(
	db: Executor,
	editionId: string,
	bound: number | null,
	anchors: UnitAnchors,
) {
	const [withHidden, { subjects, links }] = await Promise.all([
		getMergedObservedNames(db, editionId, bound, anchors, {
			includeHidden: true,
		}),
		loadSubjectLinks(db, editionId),
	]);
	// Names appear, and subjects are named, through visible rows only.
	const rows = withHidden.filter((r) => !r.hidden);
	const appearances = firstAppearances(rows);
	const resolution = buildResolution({ subjects, links, appearances, bound });
	return { rows, withHidden, links, appearances, resolution };
}

/**
 * Resolves observation names into subjects at a bound (design D6): through
 * the alias links visible at the bound, with each subject's display name
 * chosen among the names that have appeared within it. The one rule the
 * Index, the assistant's lookups and glosses share.
 */
export async function resolveSubjects(
	db: Executor,
	editionId: string,
	bound: number | null,
	anchors: UnitAnchors,
): Promise<SubjectResolution> {
	return (await subjectsAt(db, editionId, bound, anchors)).resolution;
}

/** The reader's merge proposals at a bound: names visible there only. */
export async function listProposals(
	db: Executor,
	editionId: string,
	bound: number | null,
	anchors: UnitAnchors,
): Promise<MergeProposal[]> {
	const [{ rows, links, appearances, resolution }, dismissedRows] =
		await Promise.all([
			subjectsAt(db, editionId, bound, anchors),
			db
				.select({
					keyA: guideDismissedProposals.keyA,
					keyB: guideDismissedProposals.keyB,
				})
				.from(guideDismissedProposals)
				.where(eq(guideDismissedProposals.editionId, editionId)),
		]);
	const kinds = new Map<string, ObservationKind[]>();
	for (const row of rows) {
		kinds.set(row.nameKey, [...(kinds.get(row.nameKey) ?? []), ...row.kinds]);
	}
	// A name's kind: its subject's reader kind, or the kind its observations carry.
	const names = [...kinds].map(([key, observed]) => ({
		key,
		kind: resolution.kindOf(resolution.refOf(key)) ?? dominantKind(observed),
	}));
	return proposeMerges({
		names,
		resolution,
		appearances,
		links,
		dismissed: new Set(
			dismissedRows.map(
				(d) => `${d.keyA}
${d.keyB}`,
			),
		),
	});
}

/**
 * A subject's kind: the kind most of its observations carry, ties going to
 * the earliest observed. `kinds` is in reading order and not empty.
 */
export function dominantKind(kinds: ObservationKind[]): ObservationKind {
	const counts = new Map<ObservationKind, number>();
	for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
	let best = kinds[0] as ObservationKind;
	for (const kind of kinds) {
		if ((counts.get(kind) ?? 0) > (counts.get(best) ?? 0)) best = kind;
	}
	return best;
}

/** A subject in the Index at a bound. */
export interface GuideSubjectEntry {
	ref: string;
	/** The subject's display name at the bound. */
	name: string;
	/** The reader's kind when set, otherwise the kind its observations carry. */
	kind: ObservationKind;
	/** The kind the reader set, or null. */
	readerKind: ObservationKind | null;
	/** Its names that have appeared within the bound, earliest first. */
	names: SubjectName[];
	/** Units within the bound in which it is observed. */
	unitCount: number;
	/** Where it is first observed within the bound. */
	firstPosition: number;
	firstUnitLabel: string;
	/**
	 * Every observation of it within the bound is suppressed by the reader:
	 * listed only when hidden rows are asked for.
	 */
	hidden: boolean;
}

/**
 * The Index at a bound: every subject with at least one observation ending
 * at or before it, with its name, kind, unit count and first appearance,
 * sorted by name. With `includeHidden`, subjects whose observations are all
 * suppressed are listed too, marked hidden.
 */
export async function listSubjects(
	db: Executor,
	editionId: string,
	bound: number | null,
	anchors: UnitAnchors,
	{ includeHidden = false }: MergeOptions = {},
): Promise<GuideSubjectEntry[]> {
	const { rows, withHidden, resolution } = await subjectsAt(
		db,
		editionId,
		bound,
		anchors,
	);
	const subjects = new Map<
		string,
		{ first: GuideObservedName; units: Set<number>; kinds: ObservationKind[] }
	>();
	// Rows are in reading order, so a subject's first row is its first
	// appearance. Visible rows come first, so a subject with any visible
	// observation is described by those alone.
	const hiddenRows = includeHidden ? withHidden.filter((r) => r.hidden) : [];
	const visible = new Set(rows.map((r) => resolution.refOf(r.nameKey)));
	for (const row of [...rows, ...hiddenRows]) {
		const ref = resolution.refOf(row.nameKey);
		if (row.hidden && visible.has(ref)) continue;
		const subject = subjects.get(ref);
		if (subject) {
			subject.units.add(row.unitOrdinal);
			subject.kinds.push(...row.kinds);
		} else {
			subjects.set(ref, {
				first: row,
				units: new Set([row.unitOrdinal]),
				kinds: [...row.kinds],
			});
		}
	}
	return [...subjects]
		.map(([ref, { first, units, kinds }]) => ({
			ref,
			name: resolution.nameOf(ref) ?? first.name,
			kind: resolution.kindOf(ref) ?? dominantKind(kinds),
			readerKind: resolution.kindOf(ref),
			names: resolution.namesOf(ref),
			unitCount: units.size,
			firstPosition: first.endPosition,
			firstUnitLabel: first.unitLabel,
			hidden: !visible.has(ref),
		}))
		.sort(
			(a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
				a.firstPosition - b.firstPosition,
		);
}

/** One observation on a subject's timeline. */
export interface TimelineEntry {
	unitOrdinal: number;
	unitLabel: string;
	unitLocator: string;
	endPosition: number;
	/** The name it was observed under, when that differs from the subject's name. */
	observedAs: string | null;
	kind: ObservationKind;
	/** The name key it was observed under: with its unit, what a correction names. */
	nameKey: string;
	note: string;
	citations: DerivedCitation[];
	/** The reader's correction applied to it, or null. */
	correction: CorrectionMark | null;
}

export interface SubjectTimeline {
	ref: string;
	name: string;
	kind: ObservationKind;
	readerKind: ObservationKind | null;
	/** Its names that have appeared within the bound, earliest first. */
	names: SubjectName[];
	entries: TimelineEntry[];
}

/**
 * A subject's timeline at a bound: the observations of every name grouped
 * into the subject at the bound (resolveSubjects), in reading order. Null when the subject has no
 * observation within the bound, so a later subject is not disclosed.
 * With `includeHidden`, suppressed observations are kept, marked.
 * Assembled on each call, never stored.
 */
export async function getSubjectTimeline(
	db: Executor,
	editionId: string,
	ref: string,
	bound: number | null,
	anchors: UnitAnchors,
	options: MergeOptions = {},
): Promise<SubjectTimeline | null> {
	const resolution = await resolveSubjects(db, editionId, bound, anchors);
	const keys = resolution.keysOf(ref);
	if (!keys) return null;
	const rows = await getMergedObservations(
		db,
		editionId,
		bound,
		anchors,
		keys,
		options,
	);
	const [first] = rows;
	if (!first) return null;
	const name = resolution.nameOf(ref) ?? first.name;
	const shown = rows.filter((r) => r.correction?.action !== "suppress");
	return {
		ref,
		name,
		kind:
			resolution.kindOf(ref) ??
			dominantKind((shown.length > 0 ? shown : rows).map((r) => r.kind)),
		readerKind: resolution.kindOf(ref),
		names: resolution.namesOf(ref),
		entries: rows.map((r) => ({
			unitOrdinal: r.unitOrdinal,
			unitLabel: r.unitLabel,
			unitLocator: r.unitLocator,
			endPosition: r.endPosition,
			observedAs: r.name === name ? null : r.name,
			kind: r.kind,
			nameKey: r.nameKey,
			note: r.note,
			citations: r.citations,
			correction: r.correction,
		})),
	};
}
