import { and, eq, isNotNull } from "drizzle-orm";
import { type Forward, getReadingUnits } from "#/modules/catalog";
import type { Executor } from "#/server/db";
import { correctionKey } from "./corrections";
import { guideCorrections, guideSubjectAliases, readerNotes } from "./schema";

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

/**
 * Correction unit anchors follow their passage's text too. A correction
 * keeps applying when its forwarded anchor still starts a reading unit of
 * the new structure; otherwise the unit it corrected is gone, so it is
 * marked detached and applies nowhere, rather than being reapplied to a
 * different unit. A detached correction stays detached until the reader
 * drops or rewrites it.
 */
async function reanchorCorrections(
	tx: Executor,
	editionId: string,
	forward: Forward,
): Promise<void> {
	const corrections = await tx
		.select({
			id: guideCorrections.id,
			target: guideCorrections.target,
			unitLocator: guideCorrections.unitLocator,
			nameKey: guideCorrections.nameKey,
			detached: guideCorrections.detached,
		})
		.from(guideCorrections)
		.where(eq(guideCorrections.editionId, editionId))
		.orderBy(guideCorrections.id);
	if (corrections.length === 0) return;
	const starts = new Set(
		(await getReadingUnits(tx, editionId)).map((u) => u.startLocator),
	);
	// Two anchors forwarded to one passage would collide on the correction
	// key; the later one keeps its old locator and is detached.
	const taken = new Set<string>();
	for (const c of corrections) {
		const next = forward(c.unitLocator);
		let locator = next?.locator ?? c.unitLocator;
		let detached = c.detached || next === null || !starts.has(locator);
		const key = `${c.target}
${correctionKey(locator, c.nameKey)}`;
		if (taken.has(key)) {
			locator = c.unitLocator;
			detached = true;
		} else taken.add(key);
		if (locator === c.unitLocator && detached === c.detached) continue;
		await tx
			.update(guideCorrections)
			.set({ unitLocator: locator, detached, updatedAt: new Date() })
			.where(eq(guideCorrections.id, c.id));
	}
}

/**
 * Note "as of" anchors follow their passage's text, or move to the next
 * surviving passage when it was removed: never earlier, so a reparse never
 * shows a note sooner. A unit anchor stays one while its forwarded passage
 * still ends a unit, and otherwise becomes that passage. With nothing after
 * it surviving, the anchor moves to the end of the book. A unit attachment
 * follows its unit's first passage, and is cleared when that passage no
 * longer starts a unit: the note stays, listed in the Notes view.
 */
async function reanchorNotes(
	tx: Executor,
	editionId: string,
	forward: Forward,
): Promise<void> {
	const notes = await tx
		.select({
			id: readerNotes.id,
			kind: readerNotes.asOfKind,
			locator: readerNotes.asOfLocator,
			position: readerNotes.asOfPosition,
			label: readerNotes.asOfLabel,
			unitLocator: readerNotes.unitLocator,
		})
		.from(readerNotes)
		.where(eq(readerNotes.editionId, editionId))
		.orderBy(readerNotes.id);
	if (notes.length === 0) return;
	const units = await getReadingUnits(tx, editionId);
	const starts = new Set(units.map((u) => u.startLocator));
	for (const note of notes) {
		let asOf = {
			asOfKind: note.kind,
			asOfLocator: note.locator,
			asOfPosition: note.position,
			asOfLabel: note.label,
		};
		if (note.locator !== null) {
			const next = forward(note.locator);
			if (next === null) {
				asOf = {
					asOfKind: "end",
					asOfLocator: null,
					asOfPosition: null,
					asOfLabel: null,
				};
			} else {
				const ending =
					note.kind === "unit"
						? units.find((u) => u.endPosition === next.position)
						: undefined;
				const holding = units.find(
					(u) =>
						u.startPosition <= next.position && next.position <= u.endPosition,
				);
				asOf = {
					asOfKind: ending ? "unit" : "passage",
					asOfLocator: next.locator,
					asOfPosition: next.position,
					asOfLabel: (ending ?? holding)?.label ?? null,
				};
			}
		}
		let unitLocator = note.unitLocator;
		if (unitLocator !== null) {
			const next = forward(unitLocator);
			unitLocator = next && starts.has(next.locator) ? next.locator : null;
		}
		if (
			asOf.asOfKind === note.kind &&
			asOf.asOfLocator === note.locator &&
			asOf.asOfPosition === note.position &&
			asOf.asOfLabel === note.label &&
			unitLocator === note.unitLocator
		)
			continue;
		await tx
			.update(readerNotes)
			.set({ ...asOf, unitLocator })
			.where(eq(readerNotes.id, note.id));
	}
}

/** Every kind of reveal anchor, re-anchored in this order. */
const REANCHORS: Reanchor[] = [
	reanchorAliasReveals,
	reanchorCorrections,
	reanchorNotes,
];

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
