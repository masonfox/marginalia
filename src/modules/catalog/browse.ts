import { asc, count, eq } from "drizzle-orm";
import type { Executor } from "#/server/db";
import { passages, tocEntries } from "./schema";

export interface TocNode {
	label: string;
	locator: string | null;
	/** When the target passage may be revealed; null when the entry has no passage. */
	revealPosition: number | null;
	children: TocNode[];
}

/** The edition's table of contents as a tree, each entry with its target passage locator. */
export async function getToc(
	db: Executor,
	editionId: string,
): Promise<TocNode[]> {
	const rows = await db
		.select({
			id: tocEntries.id,
			parentId: tocEntries.parentId,
			label: tocEntries.label,
			locator: passages.locator,
			revealPosition: passages.revealPosition,
		})
		.from(tocEntries)
		.leftJoin(passages, eq(tocEntries.passageId, passages.id))
		.where(eq(tocEntries.editionId, editionId))
		.orderBy(
			asc(tocEntries.depth),
			asc(tocEntries.parentId),
			asc(tocEntries.ordinal),
		);
	const nodes = new Map<number, TocNode>();
	const roots: TocNode[] = [];
	for (const r of rows)
		nodes.set(r.id, {
			label: r.label,
			locator: r.locator,
			revealPosition: r.revealPosition,
			children: [],
		});
	for (const r of rows) {
		const node = nodes.get(r.id) as TocNode;
		const parent = r.parentId === null ? undefined : nodes.get(r.parentId);
		(parent ? parent.children : roots).push(node);
	}
	return roots;
}

export async function countPassages(
	db: Executor,
	editionId: string,
): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(passages)
		.where(eq(passages.editionId, editionId));
	return row?.n ?? 0;
}
