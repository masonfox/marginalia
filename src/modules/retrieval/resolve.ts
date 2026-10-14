import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
	locatorAliases,
	passages,
	sections,
	tocEntries,
} from "#/modules/catalog";
import { parseLocator } from "#/modules/epub";
import { getEditionByShortId } from "#/modules/library";
import type { Executor } from "#/server/db";

export interface ResolvedPassage {
	locator: string;
	kind: string;
	text: string;
	position: number | null;
	revealPosition: number;
	spineIndex: number;
	blockIndex: number;
	cfi: string;
	elementId: string | null;
}

export interface ResolvedEdition {
	id: string;
	shortId: string;
	title: string;
	authors: string[];
	parserVersion: number | null;
}

export type ResolveResult =
	| {
			status: "found";
			/** True when the input came from an earlier parser version and was forwarded. */
			superseded: boolean;
			requestedLocator: string;
			currentLocator: string;
			passage: ResolvedPassage;
			edition: ResolvedEdition;
			section: { spineIndex: number; title: string | null; linear: boolean };
			/** TOC labels from the top level down to the entry containing the passage. */
			tocPath: string[];
			before: ResolvedPassage[];
			after: ResolvedPassage[];
	  }
	| {
			/** Recorded as removed by a reparse: distinct from never-issued locators. */
			status: "removed";
			requestedLocator: string;
			edition: ResolvedEdition;
	  }
	| { status: "not_found"; requestedLocator: string };

const passageColumns = {
	locator: passages.locator,
	kind: passages.kind,
	text: passages.text,
	position: passages.position,
	revealPosition: passages.revealPosition,
	spineIndex: passages.spineIndex,
	blockIndex: passages.blockIndex,
	cfi: passages.cfi,
	elementId: passages.elementId,
	sectionId: passages.sectionId,
};

/**
 * Resolves a locator to its passage, with up to `context` neighbouring
 * passages on each side within the same section. Locators from earlier parser
 * versions follow the edition's alias map. Never throws for unknown input.
 */
export async function resolveLocator(
	db: Executor,
	locator: string,
	{ context = 0 }: { context?: number } = {},
): Promise<ResolveResult> {
	const requestedLocator = locator.trim();
	const notFound = { status: "not_found", requestedLocator } as const;
	const parts = parseLocator(requestedLocator);
	if (!parts) return notFound;
	const row = await getEditionByShortId(db, parts.shortId);
	if (!row || row.parserVersion === null) return notFound;
	const edition: ResolvedEdition = {
		id: row.id,
		shortId: row.shortId,
		title: row.title,
		authors: row.authors,
		parserVersion: row.parserVersion,
	};

	let currentLocator = requestedLocator;
	let superseded = false;
	if (parts.parserVersion < row.parserVersion) {
		const [alias] = await db
			.select()
			.from(locatorAliases)
			.where(
				and(
					eq(locatorAliases.editionId, row.id),
					eq(locatorAliases.oldLocator, requestedLocator),
				),
			);
		if (!alias) return notFound;
		if (!alias.targetLocator)
			return { status: "removed", requestedLocator, edition };
		currentLocator = alias.targetLocator;
		superseded = true;
	} else if (parts.parserVersion > row.parserVersion) {
		return notFound;
	}

	const [found] = await db
		.select(passageColumns)
		.from(passages)
		.where(
			and(eq(passages.editionId, row.id), eq(passages.locator, currentLocator)),
		);
	if (!found) return notFound;
	const { sectionId, ...passage } = found;

	const [section] = await db
		.select({
			spineIndex: sections.spineIndex,
			title: sections.title,
			linear: sections.linear,
		})
		.from(sections)
		.where(eq(sections.id, sectionId));

	let before: ResolvedPassage[] = [];
	let after: ResolvedPassage[] = [];
	if (context > 0) {
		const neighbours = await db
			.select(passageColumns)
			.from(passages)
			.where(
				and(
					eq(passages.sectionId, sectionId),
					gte(passages.blockIndex, passage.blockIndex - context),
					lte(passages.blockIndex, passage.blockIndex + context),
				),
			)
			.orderBy(asc(passages.blockIndex));
		const strip = ({ sectionId: _s, ...p }: typeof found) => p;
		before = neighbours
			.filter((p) => p.blockIndex < passage.blockIndex)
			.map(strip);
		after = neighbours
			.filter((p) => p.blockIndex > passage.blockIndex)
			.map(strip);
	}

	return {
		status: "found",
		superseded,
		requestedLocator,
		currentLocator,
		passage,
		edition,
		section: section ?? {
			spineIndex: passage.spineIndex,
			title: null,
			linear: true,
		},
		tocPath: await tocPath(db, row.id, passage),
		before,
		after,
	};
}

/** Labels of the last TOC entry starting at or before the passage, and its ancestors. */
async function tocPath(
	db: Executor,
	editionId: string,
	at: { spineIndex: number; blockIndex: number },
): Promise<string[]> {
	const entries = await db
		.select({
			id: tocEntries.id,
			parentId: tocEntries.parentId,
			label: tocEntries.label,
			spineIndex: passages.spineIndex,
			blockIndex: passages.blockIndex,
		})
		.from(tocEntries)
		.leftJoin(passages, eq(tocEntries.passageId, passages.id))
		.where(eq(tocEntries.editionId, editionId));
	const byId = new Map(entries.map((e) => [e.id, e]));
	const depth = (e: (typeof entries)[number]) => {
		let d = 0;
		for (let p = e.parentId; p !== null; p = byId.get(p)?.parentId ?? null) d++;
		return d;
	};
	let best: (typeof entries)[number] | undefined;
	for (const e of entries) {
		if (e.spineIndex === null || e.blockIndex === null) continue;
		const startsBefore =
			e.spineIndex < at.spineIndex ||
			(e.spineIndex === at.spineIndex && e.blockIndex <= at.blockIndex);
		if (!startsBefore) continue;
		if (
			!best ||
			e.spineIndex > (best.spineIndex as number) ||
			(e.spineIndex === best.spineIndex &&
				e.blockIndex > (best.blockIndex as number)) ||
			(e.spineIndex === best.spineIndex &&
				e.blockIndex === best.blockIndex &&
				depth(e) > depth(best))
		) {
			best = e;
		}
	}
	const path: string[] = [];
	for (
		let e = best;
		e;
		e = e.parentId === null ? undefined : byId.get(e.parentId)
	) {
		path.unshift(e.label);
	}
	return path;
}
