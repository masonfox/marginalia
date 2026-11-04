import type { ReadingUnit } from "#/modules/catalog";
import type { ReadingPosition } from "#/modules/guide";

/**
 * How far through the book the reading position is. `index` is 1-based
 * (unit 12 of 28) and `share` is the share of the book's passages read,
 * from 0 to 1. Finished is the last unit with a full share.
 */
export interface ReadingProgress {
	index: number;
	count: number;
	share: number;
}

/**
 * The progress for a position among the book's reading units, or null when
 * the position is unset, the book has no units, or the position's unit is
 * not among them.
 */
export function readingProgress(
	position: ReadingPosition | null | undefined,
	units: ReadingUnit[] | undefined,
): ReadingProgress | null {
	if (!position || !units || units.length === 0) return null;
	const count = units.length;
	if (position.kind === "finished") return { index: count, count, share: 1 };
	const at = units.findIndex((u) => u.endPosition === position.maxPosition);
	if (at === -1) return null;
	const total = units[count - 1].endPosition;
	const share = total > 0 ? Math.min(1, position.maxPosition / total) : 0;
	return { index: at + 1, count, share };
}
