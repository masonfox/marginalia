// Spoiler-safe mapping of a provider reading to a reading position (design
// D6). Pure: the caller loads the edition's units and linear passages.
import type { ReadingPosition } from "#/modules/guide";
import type { ProgressReading, StoredReading } from "./types";

/** A reading unit, as much of it as mapping needs. */
export interface MappingUnit {
	/** Last linear position of the unit, inclusive. */
	endPosition: number;
	label: string;
}

/** A linear passage, in reading order. */
export interface MappingPassage {
	position: number;
	spineIndex: number;
	/** Length of the passage's text in characters. */
	chars: number;
}

export interface MappingInput {
	/** The edition's reading units, in reading order. */
	units: MappingUnit[];
	/** The edition's linear passages, ordered by position. */
	passages: MappingPassage[];
}

type Reading = Pick<
	ProgressReading | StoredReading,
	"state" | "locator" | "fraction" | "pages"
>;

// Absorbs float error in `fraction × total`, so a fraction meant to land
// exactly on a unit end is not pushed a unit early.
const EPSILON = 1e-9;

/**
 * The reading position a provider reading maps to, or null for unset. It
 * rounds down to the last unit the reader has finished, never the unit that
 * holds the reader's current place. A spine locator takes precedence over a
 * fraction, and pages are read as the fraction current / total.
 */
export function mapReading(
	reading: Reading,
	{ units, passages }: MappingInput,
): ReadingPosition | null {
	if (reading.state === "not-started") return null;
	if (reading.state === "finished") return { kind: "finished" };
	const fraction = fractionOf(reading);
	if (reading.locator) {
		const target = locatorTarget(reading.locator, passages);
		if (target !== null)
			return toPosition(units.filter((u) => u.endPosition < target).at(-1));
	}
	if (fraction === null) return null;
	if (fraction >= 1) return { kind: "finished" };
	return toPosition(lastUnitByFraction(fraction, units, passages));
}

function fractionOf(reading: Reading): number | null {
	if (reading.fraction !== undefined && Number.isFinite(reading.fraction))
		return reading.fraction;
	const pages = reading.pages;
	if (pages && pages.total > 0 && Number.isFinite(pages.current))
		return pages.current / pages.total;
	return null;
}

/**
 * The linear position the reader is at: the first linear passage of spine
 * section `index`, or with `offset` the passage that far into it. A section
 * with no linear passages resolves to the next linear passage after it.
 * Null when the locator lies past the last linear passage.
 */
function locatorTarget(
	locator: NonNullable<Reading["locator"]>,
	passages: MappingPassage[],
): number | null {
	const first = passages.findIndex((p) => p.spineIndex >= locator.index);
	if (first === -1) return null;
	const start = passages[first] as MappingPassage;
	if (start.spineIndex !== locator.index || !locator.offset)
		return start.position;
	let i = first;
	for (let n = 0; n < locator.offset; n++) {
		const next = passages[i + 1];
		if (!next || next.spineIndex !== locator.index) break;
		i++;
	}
	return (passages[i] as MappingPassage).position;
}

/** The last unit whose text, by character count, ends at or before the fraction. */
function lastUnitByFraction(
	fraction: number,
	units: MappingUnit[],
	passages: MappingPassage[],
): MappingUnit | undefined {
	const total = passages.reduce((sum, p) => sum + p.chars, 0);
	if (total === 0) return undefined;
	const reached = fraction * total + EPSILON * total;
	let found: MappingUnit | undefined;
	let cumulative = 0;
	let p = 0;
	for (const unit of units) {
		while (
			p < passages.length &&
			(passages[p] as MappingPassage).position <= unit.endPosition
		) {
			cumulative += (passages[p] as MappingPassage).chars;
			p++;
		}
		if (cumulative > reached) break;
		found = unit;
	}
	return found;
}

const toPosition = (unit: MappingUnit | undefined): ReadingPosition | null =>
	unit
		? { kind: "unit", maxPosition: unit.endPosition, scopeLabel: unit.label }
		: null;
