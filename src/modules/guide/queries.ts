import { getReadingUnits, type ReadingUnit } from "#/modules/catalog";
import type { Executor } from "#/server/db";

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
