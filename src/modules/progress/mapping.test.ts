import { describe, expect, it } from "vitest";
import {
	type MappingInput,
	type MappingPassage,
	type MappingUnit,
	mapReading,
} from ".";

// 20 chapters, one spine section each (spine 1..20), 10 passages of 100
// characters per chapter: Chapter n spans positions (n-1)*10 .. n*10-1 and
// ends at n/20 = n*5% of the text.
function book(chars = (_chapter: number) => 100): MappingInput {
	const units: MappingUnit[] = [];
	const passages: MappingPassage[] = [];
	for (let n = 1; n <= 20; n++) {
		for (let i = 0; i < 10; i++)
			passages.push({
				position: (n - 1) * 10 + i,
				spineIndex: n,
				chars: chars(n),
			});
		units.push({ endPosition: n * 10 - 1, label: `Chapter ${n}` });
	}
	return { units, passages };
}

const chapter = (n: number) => ({
	kind: "unit",
	maxPosition: n * 10 - 1,
	scopeLabel: `Chapter ${n}`,
});

describe("mapReading", () => {
	const input = book();

	it("rounds a mid-chapter fraction down to the previous chapter", () => {
		// 57% falls inside Chapter 12 (55%..60%).
		expect(mapReading({ state: "reading", fraction: 0.57 }, input)).toEqual(
			chapter(11),
		);
	});

	it("takes the chapter a fraction lands exactly at the end of", () => {
		expect(mapReading({ state: "reading", fraction: 0.55 }, input)).toEqual(
			chapter(11),
		);
		expect(mapReading({ state: "reading", fraction: 0.05 }, input)).toEqual(
			chapter(1),
		);
	});

	it("weights a fraction by text length", () => {
		// Chapter 1 holds half the text, so 50% is the end of Chapter 1.
		const skewed = book((n) => (n === 1 ? 1900 : 100));
		expect(mapReading({ state: "reading", fraction: 0.5 }, skewed)).toEqual(
			chapter(1),
		);
		expect(mapReading({ state: "reading", fraction: 0.49 }, skewed)).toBeNull();
	});

	it("maps a spine locator to the chapter before the one it is in", () => {
		// Spine section 9 is where Chapter 9 starts.
		const at = (offset?: number) =>
			mapReading(
				{ state: "reading", locator: { kind: "spine", index: 9, offset } },
				input,
			);
		expect(at()).toEqual(chapter(8));
		expect(at(0)).toEqual(chapter(8));
		expect(at(3)).toEqual(chapter(8));
		// An offset past the section's end stays inside the section.
		expect(at(50)).toEqual(chapter(8));
	});

	it("resolves a locator in a section with no linear passages to the next one", () => {
		const gap = book();
		gap.passages = gap.passages.filter((p) => p.spineIndex !== 9);
		expect(
			mapReading(
				{ state: "reading", locator: { kind: "spine", index: 9 } },
				gap,
			),
		).toEqual(chapter(9));
	});

	it("prefers a locator over a fraction", () => {
		expect(
			mapReading(
				{
					state: "reading",
					fraction: 0.9,
					locator: { kind: "spine", index: 9 },
				},
				input,
			),
		).toEqual(chapter(8));
	});

	it("falls back to the fraction when the locator is past the text", () => {
		expect(
			mapReading(
				{
					state: "reading",
					fraction: 0.57,
					locator: { kind: "spine", index: 99 },
				},
				input,
			),
		).toEqual(chapter(11));
	});

	it("reads pages as the fraction current / total", () => {
		expect(
			mapReading(
				{ state: "reading", pages: { current: 114, total: 200 } },
				input,
			),
		).toEqual(chapter(11));
		expect(
			mapReading(
				{ state: "reading", pages: { current: 110, total: 200 } },
				input,
			),
		).toEqual(chapter(11));
	});

	it("leaves a reading short of the first chapter's end unset", () => {
		// Chapter 1 ends at 5%.
		expect(mapReading({ state: "reading", fraction: 0.02 }, input)).toBeNull();
		expect(mapReading({ state: "reading", fraction: 0 }, input)).toBeNull();
		expect(
			mapReading(
				{ state: "reading", locator: { kind: "spine", index: 1, offset: 4 } },
				input,
			),
		).toBeNull();
	});

	it("gives finished for a finished state or a fraction of 1 or more", () => {
		expect(mapReading({ state: "finished" }, input)).toEqual({
			kind: "finished",
		});
		expect(mapReading({ state: "finished", fraction: 0.3 }, input)).toEqual({
			kind: "finished",
		});
		expect(mapReading({ state: "reading", fraction: 1 }, input)).toEqual({
			kind: "finished",
		});
		expect(mapReading({ state: "reading", fraction: 1.2 }, input)).toEqual({
			kind: "finished",
		});
		expect(
			mapReading(
				{ state: "reading", pages: { current: 200, total: 200 } },
				input,
			),
		).toEqual({ kind: "finished" });
	});

	it("leaves a not-started reading unset", () => {
		expect(
			mapReading({ state: "not-started", fraction: 0.5 }, input),
		).toBeNull();
	});

	it("leaves a reading with nothing to place unset", () => {
		expect(mapReading({ state: "reading" }, input)).toBeNull();
		expect(
			mapReading({ state: "reading", pages: { current: 3, total: 0 } }, input),
		).toBeNull();
		expect(
			mapReading(
				{ state: "reading", fraction: 0.5 },
				{ units: [], passages: [] },
			),
		).toBeNull();
	});
});
