import { and, eq, isNotNull } from "drizzle-orm";
import type { Forward } from "#/modules/catalog";
import type { Executor } from "#/server/db";
import { guideSubjectAliases } from "./schema";

/**
 * The position of a reveal anchor whose text no longer survives anywhere at
 * or after it: past every unit, so it shows only at the whole-book bound.
 */
export const END_OF_BOOK_POSITION = 2147483647;

/** Moves one kind of reader-authored reveal anchor after a reparse. */
type Reanchor = (
	tx: Executor,
	editionId: string,
	forward: Forward,
) => Promise<void>;

/**
 * Alias reveal anchors follow their passage's text, or move to the next
 * surviving passage when it was removed: never earlier than the text they
 * covered, so a reparse never discloses an identity sooner. With nothing
 * after it surviving, an anchor moves past the end of the book; its locator
 * is kept, since no passage holds its text.
 */
async function reanchorAliasReveals(
	tx: Executor,
	editionId: string,
	forward: Forward,
): Promise<void> {
	const links = await tx
		.select({
			nameKey: guideSubjectAliases.nameKey,
			locator: guideSubjectAliases.revealLocator,
			position: guideSubjectAliases.revealPosition,
		})
		.from(guideSubjectAliases)
		.where(
			and(
				eq(guideSubjectAliases.editionId, editionId),
				isNotNull(guideSubjectAliases.revealLocator),
			),
		);
	for (const link of links) {
		const locator = link.locator as string;
		const next = forward(locator) ?? {
			locator,
			position: END_OF_BOOK_POSITION,
		};
		if (next.locator === locator && next.position === link.position) continue;
		await tx
			.update(guideSubjectAliases)
			.set({ revealLocator: next.locator, revealPosition: next.position })
			.where(
				and(
					eq(guideSubjectAliases.editionId, editionId),
					eq(guideSubjectAliases.nameKey, link.nameKey),
				),
			);
	}
}

/** Every kind of reveal anchor, re-anchored in this order. */
const REANCHORS: Reanchor[] = [reanchorAliasReveals];

/**
 * Re-anchors the edition's reader-authored reveal anchors after a reparse
 * (design D2), in the transaction that replaced the structure and after the
 * new passages and TOC are written. Reveal anchors are floors, so they move
 * with `forward` and never earlier; bounds such as the reading position move
 * with `rebase` instead (rebaseReadingPositions).
 */
export async function reanchor(
	tx: Executor,
	editionId: string,
	forward: Forward,
): Promise<void> {
	for (const step of REANCHORS) await step(tx, editionId, forward);
}
