import { describe, expect, it } from "vitest";
import type { ReadingUnit } from "#/modules/catalog";
import { readingProgress } from "./reading-progress";

/** 28 units of uneven length: unit i ends at passage (i + 1) * 10, the last at 400. */
const units: ReadingUnit[] = Array.from({ length: 28 }, (_, i) => ({
	ordinal: i,
	label: `Chapter ${i + 1}`,
	path: [`Chapter ${i + 1}`],
	startPosition: i * 10,
	endPosition: i === 27 ? 400 : (i + 1) * 10,
	startLocator: `loc-${i}`,
}));

const at = (maxPosition: number) => ({
	kind: "unit" as const,
	maxPosition,
	scopeLabel: `through ${maxPosition}`,
});

describe("readingProgress", () => {
	it("gives the unit's index of the count and the share of passages through it", () => {
		expect(readingProgress(at(120), units)).toEqual({
			index: 12,
			count: 28,
			share: 0.3,
		});
		expect(readingProgress(at(10), units)).toEqual({
			index: 1,
			count: 28,
			share: 0.025,
		});
		expect(readingProgress(at(400), units)).toEqual({
			index: 28,
			count: 28,
			share: 1,
		});
	});

	it("is full when finished", () => {
		expect(readingProgress({ kind: "finished" }, units)).toEqual({
			index: 28,
			count: 28,
			share: 1,
		});
	});

	it("is none when the position is unset", () => {
		expect(readingProgress(null, units)).toBeNull();
		expect(readingProgress(undefined, units)).toBeNull();
	});

	it("is none until the units load, or when the position's unit is gone", () => {
		expect(readingProgress(at(120), undefined)).toBeNull();
		expect(readingProgress({ kind: "finished" }, [])).toBeNull();
		expect(readingProgress(at(125), units)).toBeNull();
	});
});
