import { and, asc, eq, gt } from "drizzle-orm";
import { passages } from "#/modules/catalog";
import type { Executor } from "#/server/db";
import {
	type ResolvedPassage,
	type ResolveResult,
	resolveLocator,
} from "./resolve";

export type ReadForwardResult =
	| (Omit<Extract<ResolveResult, { status: "found" }>, "before" | "after"> & {
			/** Up to `limit` passages of the same section following the resolved one, in order. */
			following: ResolvedPassage[];
			/** The passage right after `following` when the section continues past the limit. */
			continuation: ResolvedPassage | null;
			/** The first passage of the next section when this one ends within the limit. */
			nextSection: ResolvedPassage | null;
	  })
	| Exclude<ResolveResult, { status: "found" }>;

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
};

/**
 * Resolves a locator like `resolveLocator`, then reads forward through its
 * section: up to `limit` following passages, plus where reading would resume.
 */
export async function readForward(
	db: Executor,
	locator: string,
	{ limit }: { limit: number },
): Promise<ReadForwardResult> {
	const resolved = await resolveLocator(db, locator);
	if (resolved.status !== "found") return resolved;
	const { before: _b, after: _a, ...rest } = resolved;
	const { spineIndex, blockIndex } = resolved.passage;
	const editionId = resolved.edition.id;

	const rows = await db
		.select(passageColumns)
		.from(passages)
		.where(
			and(
				eq(passages.editionId, editionId),
				eq(passages.spineIndex, spineIndex),
				gt(passages.blockIndex, blockIndex),
			),
		)
		.orderBy(asc(passages.blockIndex))
		.limit(limit + 1);
	const following = rows.slice(0, limit);
	const continuation = rows[limit] ?? null;

	let nextSection: ResolvedPassage | null = null;
	if (!continuation) {
		const [row] = await db
			.select(passageColumns)
			.from(passages)
			.where(
				and(
					eq(passages.editionId, editionId),
					gt(passages.spineIndex, spineIndex),
				),
			)
			.orderBy(asc(passages.spineIndex), asc(passages.blockIndex))
			.limit(1);
		nextSection = row ?? null;
	}

	return { ...rest, following, continuation, nextSection };
}
