import { asc, eq, sql } from "drizzle-orm";
import {
	formatLocator,
	type ParsedEdition,
	type ParsedTocEntry,
	parseLocator,
} from "#/modules/epub";
import { editions, markEditionReady } from "#/modules/library";
import type { Executor } from "#/server/db";
import { type LocatorMatch, matchLocators } from "./matching";
import {
	locatorAliases,
	noteRefs,
	passages,
	sections,
	tocEntries,
} from "./schema";

export interface EditionKey {
	id: string;
	shortId: string;
}

export interface ReplaceOptions {
	searchConfig: string;
	coverPath: string | null;
	/** Rows per INSERT statement. */
	batchSize?: number;
	/**
	 * Called inside the transaction after a reparse under a new parser
	 * version, once the new structure is written, so dependents (conversation
	 * bounds, reader anchors) can re-anchor atomically.
	 */
	onReplaced?: ReplacedHook;
}

/**
 * Maps a position bound from the old structure to the new one: the greatest
 * new position holding text from an old linear passage at or before it, or
 * -1 when there is none. Never moves a bound past the text it covered.
 */
export type Rebase = (oldBound: number) => number;

/** A current passage and its reveal position: where a reader anchor now points. */
export interface ForwardedAnchor {
	locator: string;
	position: number;
}

/**
 * Maps an old passage locator to the new passage holding its text or, when
 * the passage was removed, to the next surviving one. Null when nothing at or
 * after it survives, or the locator is unknown: the anchor then belongs at
 * the end of the book. Never moves an anchor earlier than the text it covered.
 */
export type Forward = (oldLocator: string) => ForwardedAnchor | null;

export type ReplacedHook = (
	tx: Executor,
	change: { editionId: string; rebase: Rebase; forward: Forward },
) => Promise<void>;

/**
 * Replaces an edition's sections, TOC, passages, and note links with `parsed`
 * and marks it ready. Must run inside a transaction: readers see either the
 * old structure or the new one. When the previous structure came from an
 * older parser version, writes locator aliases forwarding every old locator
 * to the passage that now holds its text (D4a). Returns false, writing
 * nothing, when the edition was deleted.
 */
export async function replaceEditionStructure(
	tx: Executor,
	edition: EditionKey,
	parsed: ParsedEdition,
	options: ReplaceOptions,
): Promise<boolean> {
	// Serializes with deleteEdition, which takes the same lock.
	const [live] = await tx
		.select({ id: editions.id })
		.from(editions)
		.where(eq(editions.id, edition.id))
		.for("update");
	if (!live) return false;
	// Fences derived work (preprocessing) computed from the previous structure.
	await tx
		.update(editions)
		.set({ structureGeneration: sql`${editions.structureGeneration} + 1` })
		.where(eq(editions.id, edition.id));
	const batchSize = options.batchSize ?? 2000;
	const locatorOf = (p: { spineIndex: number; blockIndex: number }) =>
		formatLocator({
			shortId: edition.shortId,
			parserVersion: parsed.parserVersion,
			...p,
		});

	const newPassages = parsed.sections.flatMap((s) =>
		s.passages.map((p) => ({ ...p, locator: locatorOf(p) })),
	);

	const old = await tx
		.select({
			locator: passages.locator,
			text: passages.text,
			position: passages.position,
		})
		.from(passages)
		.where(eq(passages.editionId, edition.id))
		.orderBy(asc(passages.spineIndex), asc(passages.blockIndex));
	const oldVersion = old[0]
		? parseLocator(old[0].locator)?.parserVersion
		: undefined;
	let remap: { rebase: Rebase; forward: Forward } | null = null;
	if (oldVersion !== undefined && oldVersion !== parsed.parserVersion) {
		const matches = matchLocators(old, newPassages);
		await writeAliases(tx, edition.id, matches, batchSize);
		remap = {
			rebase: buildRebase(old, matches, newPassages),
			forward: buildForward(old, matches, newPassages),
		};
	}

	// Sections cascade to passages and note links; TOC entries go first (they reference passages).
	await tx.delete(tocEntries).where(eq(tocEntries.editionId, edition.id));
	await tx.delete(sections).where(eq(sections.editionId, edition.id));

	const sectionIds = new Map<number, number>();
	if (parsed.sections.length > 0) {
		const rows = await tx
			.insert(sections)
			.values(
				parsed.sections.map((s) => ({
					editionId: edition.id,
					spineIndex: s.spineIndex,
					href: s.href,
					linear: s.linear,
					title: s.title,
				})),
			)
			.returning({ id: sections.id, spineIndex: sections.spineIndex });
		for (const r of rows) sectionIds.set(r.spineIndex, r.id);
	}

	const passageIds = new Map<string, number>();
	for (const chunk of chunks(newPassages, batchSize)) {
		const rows = await tx
			.insert(passages)
			.values(
				chunk.map((p) => ({
					editionId: edition.id,
					sectionId: sectionIds.get(p.spineIndex) as number,
					spineIndex: p.spineIndex,
					blockIndex: p.blockIndex,
					locator: p.locator,
					kind: p.kind,
					text: p.text,
					cfi: p.cfi,
					elementId: p.elementId,
					position: p.position,
					revealPosition: p.revealPosition,
					searchConfig: options.searchConfig,
				})),
			)
			.returning({ id: passages.id, locator: passages.locator });
		for (const r of rows) passageIds.set(r.locator, r.id);
	}
	const idOf = (ref: { spineIndex: number; blockIndex: number }) =>
		passageIds.get(locatorOf(ref)) as number;

	for (const chunk of chunks(parsed.noteRefs, batchSize)) {
		await tx
			.insert(noteRefs)
			.values(
				chunk.map((r) => ({
					fromPassageId: idOf(r.from),
					toPassageId: idOf(r.to),
				})),
			)
			.onConflictDoNothing();
	}

	await insertToc(tx, edition.id, parsed.toc, null, idOf);

	if (remap && options.onReplaced) {
		await options.onReplaced(tx, { editionId: edition.id, ...remap });
	}

	await markEditionReady(tx, edition.id, {
		...parsed.metadata,
		coverPath: options.coverPath,
		epubVersion: parsed.epubVersion,
		parserVersion: parsed.parserVersion,
		linearPassageCount: parsed.linearPassageCount,
		searchConfig: options.searchConfig,
	});
	return true;
}

async function insertToc(
	tx: Executor,
	editionId: string,
	entries: ParsedTocEntry[],
	parentId: number | null,
	idOf: (ref: { spineIndex: number; blockIndex: number }) => number,
) {
	if (entries.length === 0) return;
	const rows = await tx
		.insert(tocEntries)
		.values(
			entries.map((e, ordinal) => ({
				editionId,
				parentId,
				ordinal,
				depth: e.depth,
				label: e.label,
				passageId: e.target ? idOf(e.target) : null,
			})),
		)
		.returning({ id: tocEntries.id, ordinal: tocEntries.ordinal });
	const idByOrdinal = new Map(rows.map((r) => [r.ordinal, r.id]));
	for (const [ordinal, entry] of entries.entries()) {
		await insertToc(
			tx,
			editionId,
			entry.children,
			idByOrdinal.get(ordinal) ?? null,
			idOf,
		);
	}
}

/** Builds the bound mapping from the old-to-new passage match (design D5). */
export function buildRebase(
	old: { locator: string; position: number | null }[],
	matches: Map<string, LocatorMatch>,
	newPassages: { locator: string; position: number | null }[],
): Rebase {
	const newPosition = new Map(newPassages.map((p) => [p.locator, p.position]));
	// New linear position -> the latest old linear position whose text it holds.
	const latestSource = new Map<number, number>();
	for (const p of old) {
		if (p.position === null) continue;
		const target = matches.get(p.locator)?.target;
		const to = target ? newPosition.get(target) : null;
		if (to == null) continue;
		latestSource.set(to, Math.max(latestSource.get(to) ?? 0, p.position));
	}
	return (oldBound) => {
		let bound = -1;
		let firstLater = Number.POSITIVE_INFINITY;
		for (const [to, source] of latestSource) {
			// A merged passage that also holds later text stays hidden.
			if (source <= oldBound) bound = Math.max(bound, to);
			else firstLater = Math.min(firstLater, to);
		}
		return Math.min(bound, firstLater - 1);
	};
}

/**
 * Builds the reader-anchor mapping from the old-to-new passage match: the
 * sibling of buildRebase, for floors rather than ceilings (guide design D2).
 * An anchor follows its passage's text. A split passage's text runs on into
 * the unclaimed new passages after its target, so its anchor moves to the
 * last of them. An anchor also never lands before where the next surviving
 * old passage's text starts: the passage before an exact match, or an
 * inexact match's own target, since a merge or split may hold the anchored
 * text's end too. This may hide one passage too many, never too few. A
 * removed passage's anchor moves to where the next surviving old passage's
 * text starts. Both inputs must be in reading (spine, block) order.
 */
export function buildForward(
	old: { locator: string }[],
	matches: Map<string, LocatorMatch>,
	newPassages: { locator: string; revealPosition: number }[],
): Forward {
	const newIndex = new Map(newPassages.map((p, i) => [p.locator, i]));
	const claimed = new Set<string>();
	for (const m of matches.values()) if (m.target) claimed.add(m.target);
	const isUnclaimed = (i: number) =>
		i < newPassages.length &&
		!claimed.has((newPassages[i] as { locator: string }).locator);

	// Old locator -> new passage index, filled from the end so a removed
	// passage can take the start of the next survivor's text.
	const forwarded = new Map<string, number | null>();
	let nextStart: number | null = null;
	let nextFloor = -1;
	for (let i = old.length - 1; i >= 0; i--) {
		const locator = (old[i] as { locator: string }).locator;
		const match = matches.get(locator);
		const start = match?.target ? newIndex.get(match.target) : undefined;
		if (start === undefined) {
			forwarded.set(locator, nextStart);
			continue;
		}
		let end = start;
		if (match?.kind === "split") while (isUnclaimed(end + 1)) end++;
		forwarded.set(
			locator,
			Math.min(Math.max(end, nextFloor), newPassages.length - 1),
		);
		nextStart = start;
		nextFloor = match?.kind === "exact" ? start - 1 : start;
	}

	return (oldLocator) => {
		const i = forwarded.get(oldLocator);
		if (i == null) return null;
		const p = newPassages[i] as (typeof newPassages)[number];
		return { locator: p.locator, position: p.revealPosition };
	};
}

/**
 * Records where each old locator now points. Earlier aliases that pointed at
 * an old locator are re-pointed to its new target, so every historical
 * locator stays one hop from a current passage.
 */
async function writeAliases(
	tx: Executor,
	editionId: string,
	matches: Map<string, LocatorMatch>,
	batchSize: number,
) {
	const existing = await tx
		.select()
		.from(locatorAliases)
		.where(eq(locatorAliases.editionId, editionId));

	const rows: (typeof locatorAliases.$inferInsert)[] = [];
	for (const alias of existing) {
		const next = alias.targetLocator
			? matches.get(alias.targetLocator)
			: undefined;
		if (!next) continue;
		rows.push({
			editionId,
			oldLocator: alias.oldLocator,
			targetLocator: next.target,
			matchKind:
				next.kind === "removed"
					? "removed"
					: next.kind === "exact"
						? alias.matchKind
						: next.kind,
		});
	}
	for (const [oldLocator, match] of matches) {
		rows.push({
			editionId,
			oldLocator,
			targetLocator: match.target,
			matchKind: match.kind,
		});
	}

	for (const chunk of chunks(rows, batchSize)) {
		await tx
			.insert(locatorAliases)
			.values(chunk)
			.onConflictDoUpdate({
				target: [locatorAliases.editionId, locatorAliases.oldLocator],
				set: {
					targetLocator: sql`excluded.target_locator`,
					matchKind: sql`excluded.match_kind`,
				},
			});
	}
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
	for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
