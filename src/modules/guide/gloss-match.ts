// Margin glosses (design D8): which subject mentions to mark in the passages
// on screen. Pure and deterministic, with no model call: names are matched
// as observed, whole-word and case-sensitive, each passage at its own bound.
import {
	type AliasLink,
	type Appearance,
	buildResolution,
	type SubjectRecord,
} from "./subjects";

/** Names shorter than this, in code points, are never glossed. */
export const MIN_GLOSS_LENGTH = 3;

/** A displayed passage: its text and its own reveal position, the gloss bound. */
export interface GlossPassage {
	locator: string;
	text: string;
	revealPosition: number;
}

/** An observed name key, from the merged view (suppressed rows omitted). */
export interface GlossName {
	key: string;
	/** The names it was observed under, as written. */
	forms: string[];
	/** Where it is first observed: the end position of that unit. */
	firstPosition: number;
	/** The name as first observed. */
	firstName: string;
}

/** A marked mention: a UTF-16 range of one passage's text. */
export interface Gloss {
	locator: string;
	start: number;
	end: number;
	/** The subject at the passage's bound. */
	subjectRef: string;
	/** The matched name's key: what "don't gloss this name" excludes. */
	nameKey: string;
}

const WORD = String.raw`\p{L}\p{M}\p{N}`;
const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

/**
 * One alternation over `forms`, longest first, so the fullest name wins
 * where names overlap. Case-sensitive, with Unicode letter boundaries; any
 * whitespace in a name matches any run of whitespace in the text.
 */
export function compileGlossPattern(forms: string[]): RegExp | null {
	if (forms.length === 0) return null;
	const sorted = [...forms].sort(
		(a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
	);
	const alternatives = sorted.map((form) =>
		form.trim().split(/\s+/u).map(escapeRegExp).join(String.raw`\s+`),
	);
	return new RegExp(
		`(?<![${WORD}])(?:${alternatives.join("|")})(?![${WORD}])`,
		"gu",
	);
}

/** Whether a name is long enough to gloss. */
export const glossable = (form: string) =>
	[...form.trim()].length >= MIN_GLOSS_LENGTH;

/**
 * Marks the first mention of each subject across `passages`, in order. Each
 * passage is matched at its own reveal position: a name matches when its
 * subject has an observation ending at or before it, grouped through the
 * alias links revealed there. Excluded name keys are never matched.
 */
export function findGlosses(input: {
	passages: GlossPassage[];
	names: GlossName[];
	subjects: SubjectRecord[];
	links: AliasLink[];
	exclusions: Set<string>;
}): Gloss[] {
	const { passages, names, subjects, links, exclusions } = input;
	const patterns = new Map<string, RegExp | null>();
	const marked = new Set<string>();
	const glosses: Gloss[] = [];
	for (const passage of passages) {
		const bound = passage.revealPosition;
		const seen = names.filter((n) => n.firstPosition <= bound);
		if (seen.length === 0) continue;
		const appearances = new Map<string, Appearance>(
			seen.map((n) => [
				n.key,
				{ name: n.firstName, position: n.firstPosition, unitLabel: "" },
			]),
		);
		const resolution = buildResolution({
			subjects,
			links,
			appearances,
			bound,
		});
		// A subject is glossed once one of its names is observed within the bound.
		const visible = new Set(seen.map((n) => resolution.refOf(n.key)));
		const byForm = new Map<string, { ref: string; key: string }>();
		for (const name of names) {
			if (exclusions.has(name.key)) continue;
			const ref = resolution.refOf(name.key);
			// Marked subjects stay in the pattern, so a later mention of one is
			// not taken for a shorter name inside it.
			if (!visible.has(ref)) continue;
			for (const form of name.forms) {
				if (glossable(form))
					byForm.set(normalizeSpace(form), { ref, key: name.key });
			}
		}
		if (byForm.size === 0) continue;
		const signature = [...byForm.keys()].sort().join("\n");
		let pattern = patterns.get(signature);
		if (pattern === undefined) {
			pattern = compileGlossPattern([...byForm.keys()]);
			patterns.set(signature, pattern);
		}
		if (!pattern) continue;
		for (const match of passage.text.matchAll(pattern)) {
			const hit = byForm.get(normalizeSpace(match[0]));
			if (!hit || marked.has(hit.ref)) continue;
			marked.add(hit.ref);
			glosses.push({
				locator: passage.locator,
				start: match.index,
				end: match.index + match[0].length,
				subjectRef: hit.ref,
				nameKey: hit.key,
			});
		}
	}
	return glosses;
}

/** A name with its whitespace runs collapsed, as the pattern matches it. */
const normalizeSpace = (s: string) => s.trim().replace(/\s+/gu, " ");
