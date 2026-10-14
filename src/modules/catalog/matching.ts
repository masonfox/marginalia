import { diffArrays } from "diff";
import { normalizeText } from "#/modules/epub";
import type { LocatorMatchKind } from "./schema";

export interface MatchInput {
	locator: string;
	text: string;
}

export interface LocatorMatch {
	/** Current locator holding the old passage's text, or null when removed. */
	target: string | null;
	kind: LocatorMatchKind;
}

/** Minimum overlap for a split/merge match; below it the old passage counts as removed. */
export const OVERLAP_THRESHOLD = 0.6;

/**
 * Maps every old passage to the new passage that now holds its text (D4a).
 *
 * 1. Align the two ordered sequences of normalized texts with a sequence diff;
 *    equal runs are `exact` matches. Alignment respects order, so a sentence
 *    repeated in two chapters maps to its own occurrence.
 * 2. Between exact anchors, score each unmatched old/new pair by word-trigram
 *    overlap relative to the smaller passage (plain word overlap under three
 *    words). An old passage maps to its best candidate scoring ≥ 0.6 (earliest
 *    on ties): `split` when several new passages qualify, otherwise `merged`.
 *    No candidate means `removed`.
 *
 * Both inputs must be in reading (spine, block) order. Pure and deterministic.
 */
export function matchLocators(
	oldPassages: MatchInput[],
	newPassages: MatchInput[],
): Map<string, LocatorMatch> {
	const oldKeys = oldPassages.map((p) => normalizeText(p.text));
	const newKeys = newPassages.map((p) => normalizeText(p.text));
	const result = new Map<string, LocatorMatch>();

	let o = 0;
	let n = 0;
	let gapOld: number[] = [];
	let gapNew: number[] = [];
	const closeGap = () => {
		matchGap(gapOld, gapNew);
		gapOld = [];
		gapNew = [];
	};

	for (const change of diffArrays(oldKeys, newKeys)) {
		const count = change.value.length;
		if (change.added) {
			for (let i = 0; i < count; i++) gapNew.push(n++);
		} else if (change.removed) {
			for (let i = 0; i < count; i++) gapOld.push(o++);
		} else {
			closeGap();
			for (let i = 0; i < count; i++) {
				result.set((oldPassages[o] as MatchInput).locator, {
					target: (newPassages[n] as MatchInput).locator,
					kind: "exact",
				});
				o++;
				n++;
			}
		}
	}
	closeGap();
	return result;

	function matchGap(olds: number[], news: number[]) {
		const newShingles = news.map((j) => shingles(newKeys[j] as string));
		for (const i of olds) {
			const oldShingles = shingles(oldKeys[i] as string);
			let best = -1;
			let bestScore = 0;
			let qualifying = 0;
			news.forEach((j, k) => {
				const score = overlap(oldShingles, newShingles[k] as Shingles);
				if (score >= OVERLAP_THRESHOLD) qualifying++;
				if (score > bestScore) {
					bestScore = score;
					best = j;
				}
			});
			const locator = (oldPassages[i] as MatchInput).locator;
			if (best < 0 || bestScore < OVERLAP_THRESHOLD) {
				result.set(locator, { target: null, kind: "removed" });
			} else {
				result.set(locator, {
					target: (newPassages[best] as MatchInput).locator,
					kind: qualifying > 1 ? "split" : "merged",
				});
			}
		}
	}
}

interface Shingles {
	set: Set<string>;
}

function shingles(normalized: string): Shingles {
	const words = normalized.split(/[^\p{L}\p{N}']+/u).filter(Boolean);
	const set = new Set<string>();
	if (words.length < 3) {
		for (const w of words) set.add(w);
	} else {
		for (let i = 0; i + 2 < words.length; i++) {
			set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
		}
	}
	return { set };
}

/** Shared shingles relative to the smaller passage. Short passages compare by words. */
function overlap(a: Shingles, b: Shingles): number {
	let left = a.set;
	let right = b.set;
	if (left.size === 0 || right.size === 0) return 0;
	// A short passage (< 3 words) holds words, not trigrams: compare words on both sides.
	const isWords = (s: Set<string>) => [...s].every((x) => !x.includes(" "));
	if (isWords(left) !== isWords(right)) {
		left = toWords(left);
		right = toWords(right);
	}
	let shared = 0;
	for (const x of left) if (right.has(x)) shared++;
	return shared / Math.min(left.size, right.size);
}

function toWords(set: Set<string>): Set<string> {
	const words = new Set<string>();
	for (const s of set) for (const w of s.split(" ")) words.add(w);
	return words;
}
