import { describe, expect, it } from "vitest";
import { normalizeNameKey } from "#/modules/analysis";
import {
	compileGlossPattern,
	findGlosses,
	type GlossName,
	type GlossPassage,
	MIN_GLOSS_LENGTH,
} from "./gloss-match";
import type { AliasLink, SubjectRecord } from "./subjects";

/** Units end at 100 (Chapter 1), 200 (Chapter 2), 300 (Chapter 3). */
const name = (firstPosition: number, ...forms: string[]): GlossName => ({
	key: normalizeNameKey(forms[0] as string),
	forms,
	firstPosition,
	firstName: forms[0] as string,
});

const passage = (
	revealPosition: number,
	text: string,
	locator = `p${revealPosition}`,
): GlossPassage => ({ locator, text, revealPosition });

function glosses(
	passages: GlossPassage[],
	names: GlossName[],
	options: {
		subjects?: SubjectRecord[];
		links?: AliasLink[];
		exclusions?: string[];
	} = {},
) {
	return findGlosses({
		passages,
		names,
		subjects: options.subjects ?? [],
		links: options.links ?? [],
		exclusions: new Set(options.exclusions ?? []),
	}).map((g) => {
		const text = passages.find((p) => p.locator === g.locator)?.text ?? "";
		return [g.locator, text.slice(g.start, g.end), g.subjectRef, g.nameKey];
	});
}

describe("compileGlossPattern", () => {
	it("tries the longest name first", () => {
		const pattern = compileGlossPattern(["Brawne", "Brawne Lamia"]);
		expect("Brawne Lamia spoke.".match(pattern as RegExp)).toEqual([
			"Brawne Lamia",
		]);
	});

	it("escapes names and lets their spaces match any whitespace", () => {
		const pattern = compileGlossPattern(["Mr. Smith (Jr.)", "Anne-Marie"]);
		expect(
			"Then Mr.\nSmith (Jr.) met Anne-Marie, not MrX Smith (Jr.).".match(
				pattern as RegExp,
			),
		).toEqual(["Mr.\nSmith (Jr.)", "Anne-Marie"]);
	});

	it("is null without names", () => {
		expect(compileGlossPattern([])).toBeNull();
	});
});

describe("findGlosses", () => {
	it("marks a name observed in an earlier unit", () => {
		expect(
			glosses([passage(250, "Brawne waited.")], [name(100, "Brawne")]),
		).toEqual([["p250", "Brawne", "k:brawne", "brawne"]]);
	});

	it("matches whole words only, with Unicode letters as word characters", () => {
		const names = [name(100, "Ana"), name(100, "Éowyn"), name(100, "Zoë")];
		expect(
			glosses(
				[
					passage(150, "Anaïs, ÉAna and Banana are not Ana's sister."),
					passage(160, "Éowynë stayed; «Éowyn» rode."),
					passage(170, "Zoëa and Zoẹ̈ differ from Zoë."),
				],
				names,
			),
		).toEqual([
			["p150", "Ana", "k:ana", "ana"],
			["p160", "Éowyn", "k:eowyn", "eowyn"],
			["p170", "Zoë", "k:zoe", "zoe"],
		]);
	});

	it("compares the observed letter case", () => {
		expect(
			glosses(
				[passage(150, "You will see. WILL is gone. Will came.")],
				[name(100, "Will")],
			),
		).toEqual([["p150", "Will", "k:will", "will"]]);
		expect(
			glosses([passage(150, "you will see")], [name(100, "Will")]),
		).toEqual([]);
	});

	it("prefers the longest name where names overlap", () => {
		expect(
			glosses(
				[passage(250, "Brawne Lamia and Lamia; then Brawne.")],
				[name(100, "Brawne"), name(100, "Brawne Lamia"), name(100, "Lamia")],
			),
		).toEqual([
			["p250", "Brawne Lamia", "k:brawne lamia", "brawne lamia"],
			["p250", "Lamia", "k:lamia", "lamia"],
			["p250", "Brawne", "k:brawne", "brawne"],
		]);
	});

	it("does not take a later mention of a marked subject for a shorter name inside it", () => {
		expect(
			glosses(
				[passage(250, "Brawne Lamia, and again Brawne Lamia, then Lamia.")],
				[name(100, "Brawne Lamia"), name(100, "Lamia")],
			),
		).toEqual([
			["p250", "Brawne Lamia", "k:brawne lamia", "brawne lamia"],
			["p250", "Lamia", "k:lamia", "lamia"],
		]);
	});

	it(`never matches names shorter than ${MIN_GLOSS_LENGTH} characters`, () => {
		expect(MIN_GLOSS_LENGTH).toBe(3);
		expect(
			glosses(
				[passage(150, "Al met Bo and Ann.")],
				[name(100, "Al"), name(100, "Bo"), name(100, "Ann")],
			),
		).toEqual([["p150", "Ann", "k:ann", "ann"]]);
	});

	it("marks nothing in the first unit, where no unit has ended", () => {
		expect(
			glosses(
				[passage(10, "Brawne arrives."), passage(90, "Brawne again.")],
				[name(100, "Brawne")],
			),
		).toEqual([]);
	});

	it("bounds each passage by its own position", () => {
		const names = [name(100, "Brawne"), name(200, "Kassad")];
		// The Chapter 2 passage cannot see Kassad, first observed in Chapter 2.
		expect(
			glosses(
				[
					passage(150, "Brawne and Kassad."),
					passage(250, "Kassad and Brawne."),
				],
				names,
			),
		).toEqual([
			["p150", "Brawne", "k:brawne", "brawne"],
			["p250", "Kassad", "k:kassad", "kassad"],
		]);
	});

	it("leaves excluded names unmarked everywhere", () => {
		expect(
			glosses(
				[passage(150, "Will and Hope."), passage(250, "Will again.")],
				[name(100, "Will"), name(100, "Hope")],
				{ exclusions: ["will"] },
			),
		).toEqual([["p150", "Hope", "k:hope", "hope"]]);
	});

	it("marks only the first mention of each subject, across names and passages", () => {
		const links: AliasLink[] = [
			{
				nameKey: "aragorn",
				subjectId: 7,
				isPrimary: true,
				revealLocator: null,
				revealPosition: null,
			},
			{
				nameKey: "strider",
				subjectId: 7,
				isPrimary: false,
				revealLocator: "r",
				revealPosition: 200,
			},
		];
		const options = {
			subjects: [{ id: 7, displayKey: null, kind: null }],
			links,
		};
		const names = [name(100, "Strider"), name(150, "Aragorn")];
		// Before the reveal, Strider is its own subject; Aragorn is not yet observed.
		expect(
			glosses([passage(120, "Strider and Aragorn. Strider.")], names, options),
		).toEqual([["p120", "Strider", "k:strider", "strider"]]);
		// After it, both names are one subject, marked once.
		expect(
			glosses(
				[
					passage(250, "Aragorn spoke.", "a"),
					passage(260, "Strider answered.", "b"),
				],
				names,
				options,
			),
		).toEqual([["a", "Aragorn", "s:7", "aragorn"]]);
	});

	it("matches every observed form of a name", () => {
		expect(
			glosses([passage(150, "ARAGORN!")], [name(100, "Aragorn", "ARAGORN")]),
		).toEqual([["p150", "ARAGORN", "k:aragorn", "aragorn"]]);
	});
});
