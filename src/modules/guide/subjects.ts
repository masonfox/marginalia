// Subjects and aliases (design D6): how observation names group into
// subjects at a bound, and which pairs of names to propose merging. Pure, so
// the one resolution rule is shared by the Index, the assistant and glosses.
import type { ObservationKind } from "#/modules/analysis";

/** A reader-confirmed subject. */
export interface SubjectRecord {
	id: number;
	displayKey: string | null;
	kind: ObservationKind | null;
}

/** A name key's link to its subject; reveal fields are null exactly for the primary. */
export interface AliasLink {
	nameKey: string;
	subjectId: number;
	isPrimary: boolean;
	revealLocator: string | null;
	revealPosition: number | null;
}

/** Where a name is first observed within a bound. */
export interface Appearance {
	/** The name as first observed. */
	name: string;
	/** The end position of the unit it is first observed in. */
	position: number;
	unitLabel: string;
}

/** One of a subject's names at a bound. */
export interface SubjectName {
	key: string;
	name: string;
}

/**
 * How observed names group into subjects at a bound. A subject is named by
 * a ref: `s:<id>` for a confirmed subject, `k:<name_key>` for a name that is
 * its own implicit subject at the bound.
 */
export interface SubjectResolution {
	refOf(nameKey: string): string;
	/** The name keys of the subject at the bound, or null when there is none. */
	keysOf(ref: string): string[] | null;
	/** The subject's names that have appeared within the bound, earliest first. */
	namesOf(ref: string): SubjectName[];
	/**
	 * The subject's display name at the bound: the chosen name when it has
	 * appeared, otherwise its earliest-appearing name. Null when none has.
	 */
	nameOf(ref: string): string | null;
	/** The reader's kind for the subject, or null when none is set. */
	kindOf(ref: string): ObservationKind | null;
}

const SUBJECT = "s:";
const IMPLICIT = "k:";

export const subjectRef = (id: number) => `${SUBJECT}${id}`;
export const implicitRef = (nameKey: string) => `${IMPLICIT}${nameKey}`;

/** Parses a subject ref, or null when it is malformed. */
export function parseRef(
	ref: string,
): { kind: "subject"; id: number } | { kind: "implicit"; key: string } | null {
	if (ref.startsWith(SUBJECT)) {
		const id = ref.slice(SUBJECT.length);
		return /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 2147483647
			? { kind: "subject", id: Number(id) }
			: null;
	}
	if (ref.startsWith(IMPLICIT) && ref.length > IMPLICIT.length)
		return { kind: "implicit", key: ref.slice(IMPLICIT.length) };
	return null;
}

/** Orders name keys by code point, as the dismissed-pair check does. */
export const compareKeys = (a: string, b: string) =>
	a < b ? -1 : a > b ? 1 : 0;

/** Whether an alias link groups its name with its subject at `bound` (null: whole book). */
export const linkVisible = (link: AliasLink, bound: number | null) =>
	link.isPrimary ||
	bound === null ||
	(link.revealPosition !== null && link.revealPosition <= bound);

/**
 * Builds the resolution at a bound from the edition's subjects and links
 * and the first appearance of each name within the bound. A primary name is
 * always grouped, an alias only once its reveal position is at or before the
 * bound; any other name is its own implicit subject.
 */
export function buildResolution(input: {
	subjects: SubjectRecord[];
	links: AliasLink[];
	appearances: Map<string, Appearance>;
	bound: number | null;
}): SubjectResolution {
	const { appearances, bound } = input;
	const subjects = new Map(input.subjects.map((s) => [s.id, s]));
	const linkOf = new Map(input.links.map((l) => [l.nameKey, l]));
	const members = new Map<number, string[]>();
	// Primary first, then the other names in key order.
	const ordered = [...input.links].sort(
		(a, b) =>
			Number(b.isPrimary) - Number(a.isPrimary) ||
			compareKeys(a.nameKey, b.nameKey),
	);
	for (const link of ordered) {
		if (!linkVisible(link, bound)) continue;
		const keys = members.get(link.subjectId) ?? [];
		keys.push(link.nameKey);
		members.set(link.subjectId, keys);
	}

	const refOf = (nameKey: string) => {
		const link = linkOf.get(nameKey);
		return link && linkVisible(link, bound)
			? subjectRef(link.subjectId)
			: implicitRef(nameKey);
	};
	const keysOf = (ref: string): string[] | null => {
		const parsed = parseRef(ref);
		if (!parsed) return null;
		if (parsed.kind === "subject") {
			if (!subjects.has(parsed.id)) return null;
			return members.get(parsed.id) ?? null;
		}
		// A name grouped into a subject at the bound has no implicit ref.
		return refOf(parsed.key) === ref ? [parsed.key] : null;
	};
	const namesOf = (ref: string): SubjectName[] =>
		(keysOf(ref) ?? [])
			.flatMap((key) => {
				const seen = appearances.get(key);
				return seen ? [{ key, seen }] : [];
			})
			.sort(
				(a, b) =>
					a.seen.position - b.seen.position || compareKeys(a.key, b.key),
			)
			.map(({ key, seen }) => ({ key, name: seen.name }));
	const subjectOf = (ref: string) => {
		const parsed = parseRef(ref);
		return parsed?.kind === "subject" ? subjects.get(parsed.id) : undefined;
	};
	return {
		refOf,
		keysOf,
		namesOf,
		nameOf: (ref) => {
			const names = namesOf(ref);
			const chosen = subjectOf(ref)?.displayKey;
			return (
				names.find((n) => n.key === chosen)?.name ?? names[0]?.name ?? null
			);
		},
		kindOf: (ref) => subjectOf(ref)?.kind ?? null,
	};
}

/** Words that never make two names the same subject on their own. */
const STOP_WORDS = new Set([
	"the",
	"and",
	"von",
	"van",
	"der",
	"del",
	"des",
	"mrs",
	"miss",
	"lady",
	"lord",
	"sir",
	"dame",
	"saint",
	"captain",
	"king",
	"queen",
	"prince",
	"princess",
	"father",
	"mother",
	"brother",
	"sister",
	"uncle",
	"aunt",
	"master",
	"mistress",
	"madame",
	"madam",
	"monsieur",
	"mister",
	"doctor",
	"professor",
	"general",
	"colonel",
	"major",
	"lieutenant",
	"sergeant",
	"reverend",
	"count",
	"countess",
	"duke",
	"duchess",
	"baron",
	"baroness",
	"emperor",
	"empress",
	"old",
	"young",
	"little",
]);

/** At most this many proposals are shown at once. */
export const MAX_PROPOSALS = 50;

/** A name key's significant words: at least 3 characters and not a stop or honorific word. */
export function significantTokens(nameKey: string): Set<string> {
	return new Set(
		nameKey
			.split(" ")
			.filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
	);
}

/** A name in the proposal input: visible at the bound, with its kind there. */
export interface ProposalName {
	key: string;
	kind: ObservationKind;
}

/** One side of a proposed merge. */
export interface ProposalSide {
	ref: string;
	key: string;
	name: string;
}

/** A proposed merge of `alias` into `primary`. Nothing changes until the reader confirms it. */
export interface MergeProposal {
	/** The longer name, kept as the subject's name. */
	primary: ProposalSide;
	/** The name whose significant words are contained in the other's. */
	alias: ProposalSide;
	kind: ObservationKind;
	/** The default reveal: the later of the two names' first appearances. */
	reveal: { endPosition: number; unitLabel: string };
}

/** The ordered key pair a dismissal is stored under. */
export const dismissalKey = (a: string, b: string): [string, string] =>
	compareKeys(a, b) < 0 ? [a, b] : [b, a];

/**
 * Proposes merges among the names visible at a bound (design D6): pairs of
 * the same kind where one name's significant words are all among the other's.
 * Pairs already linked to one subject (revealed or not) and dismissed pairs
 * are left out. Deterministic: ordered by the later first appearance, then
 * by keys, and capped at MAX_PROPOSALS.
 *
 * A pair is only considered through an index of each kind's words: the
 * contained name's rarest word must be among the fuller name's. Only the
 * best MAX_PROPOSALS are kept while scanning, so a word shared by many names
 * costs comparisons but not memory.
 */
export function proposeMerges(input: {
	names: ProposalName[];
	resolution: SubjectResolution;
	appearances: Map<string, Appearance>;
	links: AliasLink[];
	/** Dismissed pairs, as `dismissalKey` joined by a newline. */
	dismissed: Set<string>;
}): MergeProposal[] {
	const { resolution, appearances, dismissed } = input;
	const subjectOf = new Map(input.links.map((l) => [l.nameKey, l.subjectId]));
	const candidates = input.names.flatMap((n) => {
		const seen = appearances.get(n.key);
		const tokens = significantTokens(n.key);
		return seen && tokens.size > 0 ? [{ ...n, seen, tokens }] : [];
	});
	type Candidate = (typeof candidates)[number];
	const side = (c: Candidate): ProposalSide => ({
		ref: resolution.refOf(c.key),
		key: c.key,
		name: c.seen.name,
	});
	const contains = (outer: Candidate, inner: Candidate) => {
		for (const t of inner.tokens) if (!outer.tokens.has(t)) return false;
		return true;
	};

	// The candidates holding each word, per kind, in input order.
	const holders = new Map<string, number[]>();
	const wordOf = (kind: string, token: string) => `${kind}\n${token}`;
	for (const [i, c] of candidates.entries())
		for (const t of c.tokens) {
			const word = wordOf(c.kind, t);
			const list = holders.get(word);
			if (list) list.push(i);
			else holders.set(word, [i]);
		}

	// `i` and `j` are the pair's input order, which breaks ties as the
	// pairwise scan this replaces did.
	type Found = MergeProposal & { i: number; j: number };
	const order = (x: Found, y: Found) =>
		x.reveal.endPosition - y.reveal.endPosition ||
		compareKeys(x.primary.key, y.primary.key) ||
		compareKeys(x.alias.key, y.alias.key) ||
		x.i - y.i ||
		x.j - y.j;
	let found: Found[] = [];
	// A pair revealed later than this could never be kept.
	let cutoff = Number.POSITIVE_INFINITY;
	const keep = () => {
		found.sort(order);
		found = found.slice(0, MAX_PROPOSALS);
		const worst = found[MAX_PROPOSALS - 1];
		if (worst) cutoff = worst.reveal.endPosition;
	};

	for (const [n, inner] of candidates.entries()) {
		// Every name containing `inner` holds its rarest word.
		let rarest: number[] = [];
		for (const t of inner.tokens) {
			const list = holders.get(wordOf(inner.kind, t)) ?? [];
			if (rarest.length === 0 || list.length < rarest.length) rarest = list;
		}
		for (const m of rarest) {
			if (m === n) continue;
			const outer = candidates[m] as Candidate;
			if (!contains(outer, inner)) continue;
			// Names with the same words contain each other: take the pair once.
			if (m < n && contains(inner, outer)) continue;
			const [i, j] = n < m ? [n, m] : [m, n];
			const a = candidates[i] as Candidate;
			const b = candidates[j] as Candidate;
			const later = a.seen.position >= b.seen.position ? a.seen : b.seen;
			if (later.position > cutoff) continue;
			const linked = subjectOf.get(a.key);
			if (linked !== undefined && linked === subjectOf.get(b.key)) continue;
			if (resolution.refOf(a.key) === resolution.refOf(b.key)) continue;
			if (dismissed.has(dismissalKey(a.key, b.key).join("\n"))) continue;
			// The fuller name is kept; ties go to the longer, then the earlier key.
			const [primary, alias] =
				b.tokens.size > a.tokens.size ||
				(b.tokens.size === a.tokens.size &&
					(b.key.length > a.key.length ||
						(b.key.length === a.key.length && b.key < a.key)))
					? [b, a]
					: [a, b];
			found.push({
				primary: side(primary),
				alias: side(alias),
				kind: a.kind,
				reveal: { endPosition: later.position, unitLabel: later.unitLabel },
				i,
				j,
			});
			if (found.length >= 2 * MAX_PROPOSALS) keep();
		}
	}
	keep();
	return found.map(({ i: _i, j: _j, ...proposal }) => proposal);
}
