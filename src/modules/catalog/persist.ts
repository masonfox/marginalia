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
}

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
		.select({ locator: passages.locator, text: passages.text })
		.from(passages)
		.where(eq(passages.editionId, edition.id))
		.orderBy(asc(passages.spineIndex), asc(passages.blockIndex));
	const oldVersion = old[0]
		? parseLocator(old[0].locator)?.parserVersion
		: undefined;
	if (oldVersion !== undefined && oldVersion !== parsed.parserVersion) {
		await writeAliases(
			tx,
			edition.id,
			matchLocators(old, newPassages),
			batchSize,
		);
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
