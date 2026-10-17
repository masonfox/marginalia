import { describe, expect, it } from "vitest";
import {
	type AliasLink,
	type Appearance,
	buildResolution,
	compareKeys,
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

/** The pairwise scan proposeMerges replaced, kept to check it gives the same proposals. */
function pairwiseProposals(input: Parameters<typeof proposeMerges>[0]) {
	const { resolution, appearances, dismissed } = input;
	const subjectOf = new Map(input.links.map((l) => [l.nameKey, l.subjectId]));
	const candidates = input.names.flatMap((n) => {
		const at = appearances.get(n.key);
		const tokens = significantTokens(n.key);
		return at && tokens.size > 0 ? [{ ...n, seen: at, tokens }] : [];
	});
	type Candidate = (typeof candidates)[number];
	const side = (c: Candidate) => ({
		ref: resolution.refOf(c.key),
		key: c.key,
		name: c.seen.name,
	});
	const contains = (outer: Candidate, inner: Candidate) =>
		[...inner.tokens].every((t) => outer.tokens.has(t));
	const proposals: ReturnType<typeof proposeMerges> = [];
	for (const [i, a] of candidates.entries()) {
		for (const b of candidates.slice(i + 1)) {
			if (a.kind !== b.kind) continue;
			const linked = subjectOf.get(a.key);
			if (linked !== undefined && linked === subjectOf.get(b.key)) continue;
			if (resolution.refOf(a.key) === resolution.refOf(b.key)) continue;
			if (dismissed.has(dismissalKey(a.key, b.key).join("\n"))) continue;
			if (!contains(a, b) && !contains(b, a)) continue;
			const [p, q] =
				b.tokens.size > a.tokens.size ||
				(b.tokens.size === a.tokens.size &&
					(b.key.length > a.key.length ||
						(b.key.length === a.key.length && b.key < a.key)))
					? [b, a]
					: [a, b];
			const later = a.seen.position >= b.seen.position ? a.seen : b.seen;
			proposals.push({
				primary: side(p),
				alias: side(q),
				kind: a.kind,
				reveal: { endPosition: later.position, unitLabel: later.unitLabel },
			});
		}
	}
	return proposals
		.sort(
			(x, y) =>
				x.reveal.endPosition - y.reveal.endPosition ||
				compareKeys(x.primary.key, y.primary.key) ||
				compareKeys(x.alias.key, y.alias.key),
		)
		.slice(0, MAX_PROPOSALS);
}

/** A small seeded generator (mulberry32), so a failure reproduces. */
function seeded(seed: number) {
	let s = seed >>> 0;
	const next = () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		int: (n: number) => Math.floor(next() * n),
		pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] as T,
		chance: (p: number) => next() < p,
	};
}

const WORDS = [
	"anna",
	"brawne",
	"lamia",
	"kassad",
	"sol",
	"weintraub",
	"martin",
	"silenus",
	"the",
	"von",
	"al",
	"shrike",
] as const;

/** A random proposal input: names of a few words, some linked, some dismissed. */
function randomInput(seed: number): Parameters<typeof proposeMerges>[0] {
	const r = seeded(seed);
	const count = r.int(140);
	const names: ProposalName[] = [];
	const appearances = new Map<string, Appearance>();
	for (let n = 0; n < count; n++) {
		const words = Array.from({ length: 1 + r.int(3) }, () => r.pick(WORDS));
		const key = words.join(" ");
		names.push({ key, kind: r.chance(0.8) ? "character" : "place" });
		if (!appearances.has(key) && r.chance(0.95))
			appearances.set(key, seen(key, 1 + r.int(8)));
	}
	const keys = [...new Set(names.map((n) => n.key))];
	const subjects: SubjectRecord[] = [];
	const links: AliasLink[] = [];
	for (let k = 0; k < keys.length; ) {
		const size = r.chance(0.7) ? 0 : 1 + r.int(3);
		if (size > 0) {
			const id = subjects.length + 1;
			subjects.push({ id, displayKey: null, kind: null });
			for (const [m, key] of keys.slice(k, k + size).entries())
				links.push(m === 0 ? primary(key, id) : alias(key, id, 1 + r.int(8)));
		}
		k += Math.max(size, 1);
	}
	const dismissed = new Set<string>();
	for (let d = r.int(20); d > 0; d--)
		dismissed.add(dismissalKey(r.pick(keys), r.pick(keys)).join("\n"));
	return {
		names,
		resolution: buildResolution({
			subjects,
			links,
			appearances,
			bound: r.chance(0.3) ? null : 1 + r.int(8),
		}),
		appearances,
		links,
		dismissed,
	};
}

describe("proposeMerges at scale", () => {
	it("gives the pairwise scan's proposals on random inputs", () => {
		for (let seed = 1; seed <= 300; seed++) {
			const input = randomInput(seed);
			expect(proposeMerges(input), `seed ${seed}`).toEqual(
				pairwiseProposals(input),
			);
		}
	});

	it("keeps a large index fast", () => {
		// 20,000 names, mostly a given name with one of 2,000 family names.
		const names: ProposalName[] = [];
		const appearances = new Map<string, Appearance>();
		for (let i = 0; i < 20000; i++) {
			const key =
				i % 10 === 0 ? `family${i / 10}` : `given${i} family${i % 2000}`;
			names.push({ key, kind: "character" });
			appearances.set(key, seen(key, 1 + (i % 400)));
		}
		const input = {
			names,
			resolution: buildResolution({
				subjects: [],
				links: [],
				appearances,
				bound: null,
			}),
			appearances,
			links: [],
			dismissed: new Set<string>(),
		};
		const started = performance.now();
		const proposals = proposeMerges(input);
		// Generous: the pairwise scan compares some 200 million pairs here.
		expect(performance.now() - started).toBeLessThan(5000);
		expect(proposals).toHaveLength(MAX_PROPOSALS);
	});
});
