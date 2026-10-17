// Margin glosses (design D8): subject mentions in the passage reader, and the
// card a mention opens. Every read is bounded by the passage on screen, never
// by the reading position or the furthest passage opened.
import { and, eq } from "drizzle-orm";
import { normalizeNameKey, type ObservationKind } from "#/modules/analysis";
import { passages } from "#/modules/catalog";
import { editions } from "#/modules/library";
import { getSectionView } from "#/modules/retrieval";
import type { Executor } from "#/server/db";
import {
	findGlosses,
	type Gloss,
	type GlossName,
	type GlossPassage,
} from "./gloss-match";
import { listSubjectNotes, type NoteAsOf } from "./notes";
import {
	getMergedObservations,
	getSubjectTimeline,
	getUnitAnchors,
	loadSubjectLinks,
	resolveSubjects,
	type UnitAnchors,
} from "./queries";
import { guideGlossExclusions } from "./schema";

/** How many of a subject's most recent observations its card shows. */
export const GLOSS_CARD_OBSERVATIONS = 3;

/** The name keys the reader asked not to gloss in an edition. */
async function loadExclusions(
	db: Executor,
	editionId: string,
): Promise<Set<string>> {
	const rows = await db
		.select({ nameKey: guideGlossExclusions.nameKey })
		.from(guideGlossExclusions)
		.where(eq(guideGlossExclusions.editionId, editionId));
	return new Set(rows.map((r) => r.nameKey));
}

/** Observed name keys with their forms and first appearance, from merged rows in reading order. */
function collectNames(
	rows: { name: string; nameKey: string; endPosition: number }[],
	into = new Map<string, GlossName>(),
): Map<string, GlossName> {
	for (const row of rows) {
		const name = into.get(row.nameKey);
		if (!name) {
			into.set(row.nameKey, {
				key: row.nameKey,
				forms: [row.name],
				firstPosition: row.endPosition,
				firstName: row.name,
			});
		} else if (!name.forms.includes(row.name)) {
			name.forms.push(row.name);
		}
	}
	return into;
}

/**
 * The glosses of the displayed passages (design D8): the first mention of
 * each subject, each passage at its own reveal position. Observations are
 * read once, merged (corrections applied, suppressed rows omitted), at the
 * largest of those positions; the names of linked subjects observed only
 * later are read too, since an alias revealed at a passage is matched there.
 */
export async function glossesFor(
	db: Executor,
	editionId: string,
	displayed: GlossPassage[],
	anchors?: UnitAnchors,
): Promise<{
	glosses: Gloss[];
	names: Map<string, GlossName>;
	exclusions: Set<string>;
}> {
	if (displayed.length === 0)
		return { glosses: [], names: new Map(), exclusions: new Set() };
	const units = anchors ?? (await getUnitAnchors(db, editionId));
	const bound = Math.max(...displayed.map((p) => p.revealPosition));
	const [rows, { subjects, links }, exclusions] = await Promise.all([
		getMergedObservations(db, editionId, bound, units),
		loadSubjectLinks(db, editionId),
		loadExclusions(db, editionId),
	]);
	const names = collectNames(rows);
	const later = [
		...new Set(links.map((l) => l.nameKey).filter((k) => !names.has(k))),
	];
	if (later.length > 0) {
		collectNames(
			await getMergedObservations(db, editionId, null, units, later),
			names,
		);
	}
	return {
		glosses: findGlosses({
			passages: displayed,
			names: [...names.values()],
			subjects,
			links,
			exclusions,
		}),
		names,
		exclusions,
	};
}

/** A name the reader asked not to gloss, as it was first observed. */
export interface GlossExclusion {
	nameKey: string;
	name: string;
}

export interface SectionGlosses {
	glosses: Gloss[];
	/**
	 * Excluded names observed before the end of the section, so they can be
	 * glossed again; names first observed later are not disclosed.
	 */
	excluded: GlossExclusion[];
}

/**
 * The glosses of the section the passage reader shows for `locator`: its
 * passages, as the reader displays them. Empty when the passage or its
 * edition does not exist or is not ready.
 */
export async function getSectionGlosses(
	db: Executor,
	locator: string,
): Promise<SectionGlosses> {
	const none: SectionGlosses = { glosses: [], excluded: [] };
	const view = await getSectionView(db, locator);
	if (view.status !== "found") return none;
	const editionId = view.edition.id;
	if (!(await isReady(db, editionId))) return none;
	const displayed = view.passages.map((p) => ({
		locator: p.locator,
		text: p.text,
		revealPosition: p.revealPosition,
	}));
	const { glosses, names, exclusions } = await glossesFor(
		db,
		editionId,
		displayed,
	);
	const bound = Math.max(...displayed.map((p) => p.revealPosition));
	const excluded = [...exclusions].flatMap((nameKey) => {
		const name = names.get(nameKey);
		return name && name.firstPosition <= bound
			? [{ nameKey, name: name.firstName }]
			: [];
	});
	excluded.sort((a, b) => a.name.localeCompare(b.name));
	return { glosses, excluded };
}

async function isReady(db: Executor, editionId: string): Promise<boolean> {
	const [edition] = await db
		.select({ status: editions.status })
		.from(editions)
		.where(eq(editions.id, editionId));
	return edition?.status === "ready";
}

/** A note on a gloss card. */
export interface GlossCardNote {
	id: number;
	title: string;
	body: string;
	asOf: NoteAsOf;
}

/** One of the observations on a gloss card. */
export interface GlossCardObservation {
	unitLabel: string;
	/** The name it was observed under, when that differs from the subject's name. */
	observedAs: string | null;
	note: string;
	/** The reader replaced the generated text. */
	corrected: boolean;
}

/** What opening a gloss shows: the subject as of the passage on screen. */
export interface GlossCard {
	editionId: string;
	ref: string;
	/** The subject's display name at the passage's bound. */
	name: string;
	kind: ObservationKind;
	/** The last unit ending at or before the passage: what the card is as of. */
	asOfLabel: string;
	/** The most recent observations at the bound, newest first. */
	observations: GlossCardObservation[];
	/** How many observations it has at the bound, in all. */
	observationCount: number;
	/** The reader's notes attached to the subject and visible at the bound. */
	notes: GlossCardNote[];
}

/**
 * The card of a gloss: the subject at the passage's own reveal position,
 * with its display name, kind, most recent merged observations (corrections
 * applied, suppressed rows omitted) and the notes attached to it there. The
 * passage's own unit has not ended, so it is never included. Null when the
 * passage is not one of the ready edition's, or the subject has nothing
 * within the bound.
 */
export async function getGlossCard(
	db: Executor,
	editionId: string,
	ref: string,
	passageLocator: string,
): Promise<GlossCard | null> {
	const [passage] = await db
		.select({ revealPosition: passages.revealPosition })
		.from(passages)
		.where(
			and(
				eq(passages.editionId, editionId),
				eq(passages.locator, passageLocator),
			),
		);
	if (!passage || !(await isReady(db, editionId))) return null;
	const bound = passage.revealPosition;
	const anchors = await getUnitAnchors(db, editionId);
	const [timeline, resolution] = await Promise.all([
		getSubjectTimeline(db, editionId, ref, bound, anchors),
		resolveSubjects(db, editionId, bound, anchors),
	]);
	if (!timeline) return null;
	const notes = await listSubjectNotes(db, editionId, ref, bound, resolution);
	const asOf = anchors.units.filter((u) => u.endPosition <= bound).at(-1);
	return {
		editionId,
		ref,
		name: timeline.name,
		kind: timeline.kind,
		asOfLabel: asOf?.label ?? "",
		observations: timeline.entries
			.slice(-GLOSS_CARD_OBSERVATIONS)
			.reverse()
			.map((e) => ({
				unitLabel: e.unitLabel,
				observedAs: e.observedAs,
				note: e.note,
				corrected: e.correction?.action === "replace",
			})),
		observationCount: timeline.entries.length,
		notes: notes.map((n) => ({
			id: n.id,
			title: n.title,
			body: n.body,
			asOf: n.asOf,
		})),
	};
}

/**
 * Stops a name from being glossed anywhere in the edition. False when the
 * edition does not exist or the name has no key.
 */
export async function excludeGlossName(
	db: Executor,
	editionId: string,
	name: string,
): Promise<boolean> {
	const nameKey = normalizeNameKey(name);
	if (!nameKey) return false;
	const [edition] = await db
		.select({ id: editions.id })
		.from(editions)
		.where(eq(editions.id, editionId));
	if (!edition) return false;
	await db
		.insert(guideGlossExclusions)
		.values({ editionId, nameKey })
		.onConflictDoNothing();
	return true;
}

/** Glosses a name again. False when it was not excluded. */
export async function includeGlossName(
	db: Executor,
	editionId: string,
	name: string,
): Promise<boolean> {
	const deleted = await db
		.delete(guideGlossExclusions)
		.where(
			and(
				eq(guideGlossExclusions.editionId, editionId),
				eq(guideGlossExclusions.nameKey, normalizeNameKey(name)),
			),
		)
		.returning({ nameKey: guideGlossExclusions.nameKey });
	return deleted.length > 0;
}
