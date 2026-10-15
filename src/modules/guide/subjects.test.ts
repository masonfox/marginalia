import { describe, expect, it } from "vitest";
import {
	type AliasLink,
	type Appearance,
	buildResolution,
	dismissalKey,
	MAX_PROPOSALS,
	type ProposalName,
	parseRef,
	proposeMerges,
	type SubjectRecord,
	significantTokens,
} from "./subjects";

const seen = (name: string, position: number): Appearance => ({
	name,
	position,
	unitLabel: `Chapter ${position}`,
});

const primary = (nameKey: string, subjectId: number): AliasLink => ({
	nameKey,
	subjectId,
	isPrimary: true,
	revealLocator: null,
	revealPosition: null,
});

const alias = (
	nameKey: string,
	subjectId: number,
	revealPosition: number,
): AliasLink => ({
	nameKey,
	subjectId,
	isPrimary: false,
	revealLocator: `loc-${revealPosition}`,
	revealPosition,
});

/** Aragorn (primary) with Strider revealed in Chapter 10. */
function strider(
	bound: number | null,
	appearances: [string, Appearance][],
	subject: Partial<SubjectRecord> = {},
) {
	return buildResolution({
		subjects: [{ id: 1, displayKey: null, kind: null, ...subject }],
		links: [primary("aragorn", 1), alias("strider", 1, 10)],
		appearances: new Map(appearances),
		bound,
	});
}

describe("parseRef", () => {
	it("parses subject and implicit refs and rejects anything else", () => {
		expect(parseRef("s:12")).toEqual({ kind: "subject", id: 12 });
		expect(parseRef("k:brawne lamia")).toEqual({
			kind: "implicit",
			key: "brawne lamia",
		});
		for (const bad of ["s:", "s:0", "s:x", "s:99999999999", "k:", "x:1", ""])
			expect(parseRef(bad)).toBeNull();
	});
});

describe("buildResolution", () => {
	const both: [string, Appearance][] = [
		["strider", seen("Strider", 3)],
		["aragorn", seen("Aragorn", 9)],
	];

	it("keeps an alias as its own subject before its reveal", () => {
		const r = strider(8, both);
		expect(r.refOf("strider")).toBe("k:strider");
		expect(r.refOf("aragorn")).toBe("s:1");
		expect(r.keysOf("k:strider")).toEqual(["strider"]);
		expect(r.keysOf("s:1")).toEqual(["aragorn"]);
		// Nothing at this bound connects the two.
		expect(r.namesOf("s:1")).toEqual([{ key: "aragorn", name: "Aragorn" }]);
		expect(r.nameOf("k:strider")).toBe("Strider");
	});

	it("groups an alias with its subject from its reveal on", () => {
		for (const bound of [10, 12, null]) {
			const r = strider(bound, both);
			expect(r.refOf("strider")).toBe("s:1");
			expect(r.keysOf("s:1")).toEqual(["aragorn", "strider"]);
			// A grouped name has no implicit ref of its own.
			expect(r.keysOf("k:strider")).toBeNull();
			expect(r.keysOf("k:aragorn")).toBeNull();
			// Earliest-appearing name when none is chosen.
			expect(r.nameOf("s:1")).toBe("Strider");
		}
	});

	it("shows the chosen display name only once it is visible", () => {
		// Strider chose "Aragorn"; at Chapter 8 only Strider has appeared and the alias is hidden.
		const hidden = strider(8, [["strider", seen("Strider", 3)]], {
			displayKey: "aragorn",
		});
		expect(hidden.refOf("strider")).toBe("k:strider");
		expect(hidden.nameOf("k:strider")).toBe("Strider");
		expect(hidden.nameOf("s:1")).toBeNull();

		// Revealed, but "Aragorn" has not appeared yet: still shown as Strider.
		const unseen = strider(12, [["strider", seen("Strider", 3)]], {
			displayKey: "aragorn",
		});
		expect(unseen.nameOf("s:1")).toBe("Strider");

		// Both visible: the chosen name.
		const visible = strider(12, both, { displayKey: "aragorn" });
		expect(visible.nameOf("s:1")).toBe("Aragorn");
		expect(visible.namesOf("s:1").map((n) => n.key)).toEqual([
			"strider",
			"aragorn",
		]);
	});

	it("treats an unlinked name as its own implicit subject", () => {
		const r = strider(null, both);
		expect(r.refOf("gandalf")).toBe("k:gandalf");
		expect(r.keysOf("k:gandalf")).toEqual(["gandalf"]);
		expect(r.nameOf("k:gandalf")).toBeNull();
		expect(r.keysOf("s:2")).toBeNull();
		expect(r.kindOf("k:gandalf")).toBeNull();
	});

	it("reports the reader's kind for a confirmed subject", () => {
		const r = strider(null, both, { kind: "motif" });
		expect(r.kindOf("s:1")).toBe("motif");
	});
});

describe("significantTokens", () => {
	it("drops short words, stop words and honorifics", () => {
		expect([...significantTokens("captain ahab")]).toEqual(["ahab"]);
		expect([...significantTokens("mr darcy")]).toEqual(["darcy"]);
		expect([...significantTokens("lady of the lake")]).toEqual(["lake"]);
		expect([...significantTokens("the king")]).toEqual([]);
	});
});

describe("proposeMerges", () => {
	const propose = (
		names: [key: string, name: string, position: number][],
		options: {
			kinds?: Record<string, ProposalName["kind"]>;
			links?: AliasLink[];
			dismissed?: [string, string][];
			bound?: number | null;
		} = {},
	) => {
		const appearances = new Map(
			names.map(([key, name, position]) => [key, seen(name, position)]),
		);
		const links = options.links ?? [];
		const resolution = buildResolution({
			subjects: [...new Set(links.map((l) => l.subjectId))].map((id) => ({
				id,
				displayKey: null,
				kind: null,
			})),
			links,
			appearances,
			bound: options.bound ?? null,
		});
		return proposeMerges({
			names: names.map(([key]) => ({
				key,
				kind: options.kinds?.[key] ?? "character",
			})),
			resolution,
			appearances,
			links,
			dismissed: new Set(
				(options.dismissed ?? []).map((pair) =>
					dismissalKey(...pair).join("\n"),
				),
			),
		});
	};

	it("proposes Brawne into Brawne Lamia, revealed at the later first appearance", () => {
		expect(
			propose([
				["brawne", "Brawne", 2],
				["brawne lamia", "Brawne Lamia", 5],
				["lamia", "Lamia", 7],
				["kassad", "Kassad", 1],
			]),
		).toEqual([
			{
				primary: {
					ref: "k:brawne lamia",
					key: "brawne lamia",
					name: "Brawne Lamia",
				},
				alias: { ref: "k:brawne", key: "brawne", name: "Brawne" },
				kind: "character",
				reveal: { endPosition: 5, unitLabel: "Chapter 5" },
			},
			{
				primary: {
					ref: "k:brawne lamia",
					key: "brawne lamia",
					name: "Brawne Lamia",
				},
				alias: { ref: "k:lamia", key: "lamia", name: "Lamia" },
				kind: "character",
				reveal: { endPosition: 7, unitLabel: "Chapter 7" },
			},
		]);
	});

	it("ignores honorifics and stop words, and needs a shared significant word", () => {
		const pairs = propose([
			["captain ahab", "Captain Ahab", 1],
			["ahab", "Ahab", 2],
			["captain bildad", "Captain Bildad", 3],
			["the captain", "The Captain", 4],
			["mr starbuck", "Mr Starbuck", 5],
			["starbuck", "Starbuck", 6],
		]).map((p) => [p.primary.key, p.alias.key]);
		expect(pairs).toEqual([
			["captain ahab", "ahab"],
			["mr starbuck", "starbuck"],
		]);
	});

	it("proposes only names of the same kind", () => {
		expect(
			propose(
				[
					["pequod", "Pequod", 1],
					["the pequod", "The Pequod", 2],
				],
				{ kinds: { pequod: "object", "the pequod": "place" } },
			),
		).toEqual([]);
	});

	it("leaves out dismissed and already linked pairs", () => {
		const names: [string, string, number][] = [
			["will", "Will", 1],
			["will treaty", "Will Treaty", 2],
			["brawne", "Brawne", 3],
			["brawne lamia", "Brawne Lamia", 4],
		];
		expect(propose(names).map((p) => p.alias.key)).toEqual(["will", "brawne"]);
		// Dismissed in either order.
		expect(
			propose(names, { dismissed: [["will treaty", "will"]] }).map(
				(p) => p.alias.key,
			),
		).toEqual(["brawne"]);
		// Linked, even when not yet revealed at the bound.
		expect(
			propose(names, {
				links: [primary("brawne lamia", 1), alias("brawne", 1, 99)],
				bound: 4,
			}).map((p) => p.alias.key),
		).toEqual(["will"]);
	});

	it("is deterministic and capped", () => {
		const names: [string, string, number][] = [];
		for (let i = 0; i < 60; i++) {
			const word = `name${String(i).padStart(2, "0")}`;
			names.push([word, word, i]);
			names.push([`${word} smith`, `${word} Smith`, i]);
		}
		const first = propose(names);
		expect(first).toHaveLength(MAX_PROPOSALS);
		expect(propose([...names].reverse())).toEqual(first);
		expect(first[0]?.alias.key).toBe("name00");
	});
});
