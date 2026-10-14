import { describe, expect, it } from "vitest";
import {
	deriveReadingUnits,
	type UnitInput,
	type UnitSection,
	type UnitTocEntry,
} from "./reading-units";

interface Spec {
	label: string;
	at?: number | null;
	children?: Spec[];
}

/** Builds flat TOC rows from a nested spec. */
function toc(specs: Spec[]): UnitTocEntry[] {
	const rows: UnitTocEntry[] = [];
	let id = 0;
	const add = (list: Spec[], parentId: number | null) => {
		list.forEach((s, ordinal) => {
			const row = {
				id: ++id,
				parentId,
				ordinal,
				label: s.label,
				position: s.at ?? null,
			};
			rows.push(row);
			add(s.children ?? [], row.id);
		});
	};
	add(specs, null);
	return rows;
}

const input = (
	entries: UnitTocEntry[],
	last: number,
	sections: UnitSection[] = [],
): UnitInput => ({
	toc: entries,
	sections,
	firstPosition: 1,
	lastPosition: last,
});

const ranges = (units: ReturnType<typeof deriveReadingUnits>) =>
	units.map((u) => [u.label, u.startPosition, u.endPosition]);

describe("deriveReadingUnits", () => {
	it("uses a flat chapter list and folds front and back matter into it", () => {
		const chapters = Array.from({ length: 30 }, (_, i) => ({
			label: `Chapter ${i + 1}`,
			at: 10 + i * 10,
		}));
		const units = deriveReadingUnits(
			input(
				toc([
					{ label: "Cover", at: 1 },
					{ label: "Copyright", at: 2 },
					...chapters,
					{ label: "Acknowledgments", at: 400 },
				]),
				410,
			),
		);
		expect(units.map((u) => u.label)).toEqual(chapters.map((c) => c.label));
		expect(units[0]).toMatchObject({ startPosition: 1, endPosition: 19 });
		expect(units[1]).toMatchObject({ startPosition: 20, endPosition: 29 });
		expect(units.at(-1)).toMatchObject({
			label: "Chapter 30",
			startPosition: 300,
			endPosition: 410,
		});
		expect(units.map((u) => u.ordinal)).toEqual(units.map((_, i) => i));
	});

	it("uses chapters inside parts, giving each part's title page to the part that follows", () => {
		const units = deriveReadingUnits(
			input(
				toc([
					{
						label: "Part One",
						at: 1,
						children: [
							{ label: "1", at: 2 },
							{ label: "2", at: 10 },
						],
					},
					{
						label: "Part Two",
						at: 20,
						children: [
							{ label: "13", at: 21 },
							{ label: "14", at: 30 },
						],
					},
				]),
				40,
			),
		);
		expect(ranges(units)).toEqual([
			["Part One › 1", 1, 9],
			["Part One › 2", 10, 19],
			["Part Two › 13", 20, 29],
			["Part Two › 14", 30, 40],
		]);
		expect(units[2]?.path).toEqual(["Part Two", "13"]);
	});

	it("starts a unit at an entry pointing into the middle of a section", () => {
		const units = deriveReadingUnits(
			input(
				toc([
					{ label: "One", at: 1 },
					{ label: "Two", at: 7 },
					{ label: "Three", at: 12 },
				]),
				20,
			),
		);
		expect(ranges(units)).toEqual([
			["One", 1, 6],
			["Two", 7, 11],
			["Three", 12, 20],
		]);
	});

	it("orders entries by reading position", () => {
		const units = deriveReadingUnits(
			input(
				toc([
					{ label: "One", at: 1 },
					{ label: "Three", at: 20 },
					{ label: "Two", at: 10 },
					{ label: "Four", at: 30 },
				]),
				40,
			),
		);
		expect(ranges(units)).toEqual([
			["One", 1, 9],
			["Two", 10, 19],
			["Three", 20, 29],
			["Four", 30, 40],
		]);
	});

	it("starts one unit where several entries share a passage", () => {
		const units = deriveReadingUnits(
			input(
				toc([
					{ label: "One", at: 1 },
					{ label: "Two", at: 10 },
					{ label: "Two (again)", at: 10 },
					{ label: "Three", at: 20 },
				]),
				30,
			),
		);
		expect(ranges(units)).toEqual([
			["One", 1, 9],
			["Two", 10, 19],
			["Three", 20, 30],
		]);
	});

	it("ignores entries without a linear passage", () => {
		const units = deriveReadingUnits(
			input(
				toc([
					{ label: "One", at: 1 },
					{ label: "Map", at: null },
					{ label: "Two", at: 10 },
					{ label: "Three", at: 20 },
				]),
				30,
			),
		);
		expect(units.map((u) => u.label)).toEqual(["One", "Two", "Three"]);
	});

	it("makes repeated labels distinct in reading order", () => {
		const units = deriveReadingUnits(
			input(
				toc([
					{ label: "[untitled]", at: 1 },
					{ label: "[untitled]", at: 10 },
					{ label: "Year of Glad", at: 20 },
					{ label: "[untitled]", at: 30 },
				]),
				40,
			),
		);
		expect(units.map((u) => u.label)).toEqual([
			"[untitled]",
			"[untitled] (2)",
			"Year of Glad",
			"[untitled] (3)",
		]);
	});

	it("keeps a matter-like label in the middle of the book", () => {
		const units = deriveReadingUnits(
			input(
				toc([
					{ label: "Contents", at: 1 },
					{ label: "One", at: 2 },
					{ label: "Notes", at: 10 },
					{ label: "Three", at: 20 },
					{ label: "Notes", at: 30 },
					{ label: "Index", at: 35 },
				]),
				40,
			),
		);
		expect(ranges(units)).toEqual([
			["One", 1, 9],
			["Notes", 10, 19],
			["Three", 20, 40],
		]);
	});
});

describe("spine fallback", () => {
	const section = (
		title: string | null,
		firstPosition: number,
		lastPosition: number,
	) => ({ title, firstPosition, lastPosition });

	it("uses spine sections when there is no TOC", () => {
		const sections = Array.from({ length: 12 }, (_, i) =>
			section(i === 3 ? "Interlude" : null, i * 10 + 1, i * 10 + 10),
		);
		const units = deriveReadingUnits(input([], 120, sections));
		expect(units).toHaveLength(12);
		expect(units.slice(0, 5).map((u) => u.label)).toEqual([
			"Section 1",
			"Section 2",
			"Section 3",
			"Interlude",
			"Section 5",
		]);
		expect(units[0]).toMatchObject({ startPosition: 1, endPosition: 10 });
		expect(units.at(-1)).toMatchObject({
			startPosition: 111,
			endPosition: 120,
		});
	});

	it("uses spine sections when the TOC lists only cover, title, and copyright", () => {
		const sections = [
			section("Cover", 1, 1),
			section(null, 2, 10),
			section(null, 11, 20),
			section(null, 21, 30),
			section("Copyright", 31, 32),
		];
		const units = deriveReadingUnits(
			input(
				toc([
					{ label: "Cover", at: 1 },
					{ label: "The Great Novel", at: 2 },
					{ label: "Copyright", at: 31 },
				]),
				32,
				sections,
			),
		);
		expect(ranges(units)).toEqual([
			["Section 1", 1, 10],
			["Section 2", 11, 20],
			["Section 3", 21, 32],
		]);
	});

	it("has no units without linear passages", () => {
		expect(
			deriveReadingUnits({
				toc: [],
				sections: [],
				firstPosition: null,
				lastPosition: null,
			}),
		).toEqual([]);
	});
});
