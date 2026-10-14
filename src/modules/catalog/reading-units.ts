import { and, asc, eq, inArray, isNotNull, max, min } from "drizzle-orm";
import type { Executor } from "#/server/db";
import { passages, sections, tocEntries } from "./schema";

/** A chapter or its equivalent: the granularity a reader scopes a conversation by. */
export interface ReadingUnit {
	/** 0-based, in reading order. */
	ordinal: number;
	/** Display label: `path` joined with " › ", made unique. */
	label: string;
	/** Ancestor TOC labels followed by the entry's own label. */
	path: string[];
	startPosition: number;
	endPosition: number;
	/** Locator of the passage at `startPosition`. */
	startLocator: string;
}

export interface UnitTocEntry {
	id: number;
	parentId: number | null;
	/** Order among siblings. */
	ordinal: number;
	label: string;
	/** Reading-order position of the target passage; null when it has none or is non-linear. */
	position: number | null;
}

export interface UnitSection {
	title: string | null;
	/** First and last linear positions of the section's passages. */
	firstPosition: number;
	lastPosition: number;
}

export interface UnitInput {
	toc: UnitTocEntry[];
	/** Linear sections that contain linear passages, in spine order. */
	sections: UnitSection[];
	/** First and last linear positions of the edition; null when it has none. */
	firstPosition: number | null;
	lastPosition: number | null;
}

export type DerivedUnit = Omit<ReadingUnit, "startLocator">;

/** Below this many TOC units, units come from spine sections instead. */
export const MIN_TOC_UNITS = 3;

const MATTER =
	/^(cover|front ?cover|title|title ?page|half ?title|copyright|copyright page|imprint|uncopyright|colophon|contents|table of contents|dedication|epigraph|frontispiece|also by\b.*|praise for\b.*|acknowledge?ments?|about the authors?|about the publisher|notes|endnotes|index|bibliography|glossary)$/;

/** Whether a label names front or back matter (cover, copyright, index, ...). */
export function isMatterLabel(label: string | null): boolean {
	if (!label) return false;
	const key = label
		.toLowerCase()
		.replace(/[^\p{L}\p{N} ]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	return MATTER.test(key);
}

interface Candidate {
	path: string[];
	position: number;
	/** Section title or entry label, checked against the matter pattern. */
	own: string | null;
}

/**
 * Derives an edition's reading units (design D2). Units are the deepest TOC
 * entries pointing at linear passages, in reading order; each ends just
 * before the next TOC entry of any depth. Leading and trailing front and back
 * matter is folded into the neighbouring unit. With fewer than
 * MIN_TOC_UNITS such units, linear spine sections are used instead. Pure.
 */
export function deriveReadingUnits(input: UnitInput): DerivedUnit[] {
	const { firstPosition, lastPosition } = input;
	if (firstPosition === null || lastPosition === null) return [];
	const fromToc = tocCandidates(input.toc);
	const tocUnits = toUnits(fromToc.units, fromToc.boundaries, input);
	if (tocUnits.length >= MIN_TOC_UNITS) return tocUnits;
	const fromSpine = spineCandidates(input.sections);
	const spineUnits = toUnits(
		fromSpine,
		fromSpine.map((c) => c.position),
		input,
	);
	return spineUnits.length > 0 ? spineUnits : tocUnits;
}

function tocCandidates(toc: UnitTocEntry[]) {
	const children = new Map<number | null, UnitTocEntry[]>();
	for (const e of toc) {
		const list = children.get(e.parentId) ?? [];
		list.push(e);
		children.set(e.parentId, list);
	}
	for (const list of children.values())
		list.sort((a, b) => a.ordinal - b.ordinal);

	const units: Candidate[] = [];
	const boundaries: number[] = [];
	/** Walks in TOC order; returns whether the subtree has an entry with a position. */
	const walk = (parentId: number | null, ancestors: string[]): boolean => {
		let any = false;
		for (const e of children.get(parentId) ?? []) {
			const path = [...ancestors, e.label];
			const deeper = walk(e.id, path);
			if (e.position !== null) {
				boundaries.push(e.position);
				if (!deeper) units.push({ path, position: e.position, own: e.label });
			}
			any ||= deeper || e.position !== null;
		}
		return any;
	};
	walk(null, []);
	// Stable: entries sharing a passage keep TOC order, and the first one wins below.
	units.sort((a, b) => a.position - b.position);
	return { units, boundaries };
}

function spineCandidates(list: UnitSection[]): Candidate[] {
	return list.map((s) => ({
		path: s.title ? [s.title] : [],
		position: s.firstPosition,
		own: s.title,
	}));
}

function toUnits(
	sorted: Candidate[],
	boundaryList: number[],
	input: UnitInput,
): DerivedUnit[] {
	const first = input.firstPosition as number;
	const last = input.lastPosition as number;
	const distinct: Candidate[] = [];
	for (const c of sorted) {
		const prev = distinct.at(-1);
		if (c.position < first || c.position > last) continue;
		if (prev && c.position <= prev.position) continue;
		distinct.push(c);
	}
	let lo = 0;
	let hi = distinct.length;
	while (lo < hi && isMatterLabel((distinct[lo] as Candidate).own)) lo++;
	while (hi > lo && isMatterLabel((distinct[hi - 1] as Candidate).own)) hi--;
	const kept = distinct.slice(lo, hi);

	const boundaries = [...new Set(boundaryList)].sort((a, b) => a - b);
	const nextBoundary = (after: number) =>
		boundaries.find((b) => b > after) ?? last + 1;

	const seen = new Map<string, number>();
	let start = first;
	return kept.map((c, i) => {
		const isLast = i === kept.length - 1;
		const endPosition = isLast ? last : nextBoundary(c.position) - 1;
		const path = c.path.length > 0 ? c.path : [`Section ${i + 1}`];
		const base = path.join(" › ");
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		const unit: DerivedUnit = {
			ordinal: i,
			label: n === 1 ? base : `${base} (${n})`,
			path,
			startPosition: start,
			endPosition,
		};
		start = endPosition + 1;
		return unit;
	});
}

/**
 * The edition's reading units, computed from its stored TOC and sections
 * (design D1). Empty when the edition has no linear passages.
 */
export async function getReadingUnits(
	db: Executor,
	editionId: string,
): Promise<ReadingUnit[]> {
	const [toc, sectionRows] = await Promise.all([
		db
			.select({
				id: tocEntries.id,
				parentId: tocEntries.parentId,
				ordinal: tocEntries.ordinal,
				label: tocEntries.label,
				position: passages.position,
			})
			.from(tocEntries)
			.leftJoin(passages, eq(tocEntries.passageId, passages.id))
			.where(eq(tocEntries.editionId, editionId)),
		db
			.select({
				title: sections.title,
				firstPosition: min(passages.position),
				lastPosition: max(passages.position),
			})
			.from(sections)
			.innerJoin(passages, eq(passages.sectionId, sections.id))
			.where(
				and(
					eq(sections.editionId, editionId),
					eq(sections.linear, true),
					isNotNull(passages.position),
				),
			)
			.groupBy(sections.id, sections.spineIndex, sections.title)
			.orderBy(asc(sections.spineIndex)),
	]);
	const linear = sectionRows.filter(
		(s): s is UnitSection =>
			s.firstPosition !== null && s.lastPosition !== null,
	);
	const units = deriveReadingUnits({
		toc,
		sections: linear,
		firstPosition: linear[0]?.firstPosition ?? null,
		lastPosition: linear.at(-1)?.lastPosition ?? null,
	});
	if (units.length === 0) return [];
	const starts = await db
		.select({ position: passages.position, locator: passages.locator })
		.from(passages)
		.where(
			and(
				eq(passages.editionId, editionId),
				inArray(
					passages.position,
					units.map((u) => u.startPosition),
				),
			),
		);
	const locatorAt = new Map(starts.map((s) => [s.position, s.locator]));
	return units.map((u) => ({
		...u,
		startLocator: locatorAt.get(u.startPosition) as string,
	}));
}
