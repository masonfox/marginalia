/**
 * Text normalization shared by quote verification and locator forwarding:
 * NFKC, typographic quotes/dashes/ellipsis to ASCII, collapsed whitespace,
 * lowercase. Keeps a map from each normalized character back to its
 * original offset so matches can be reported in original coordinates.
 */

const FOLD: Record<string, string> = {
	"‘": "'",
	"’": "'",
	"‚": "'",
	"‛": "'",
	"′": "'",
	ʼ: "'",
	"“": '"',
	"”": '"',
	"„": '"',
	"‟": '"',
	"″": '"',
	"«": '"',
	"»": '"',
	"‐": "-",
	"‑": "-",
	"‒": "-",
	"–": "-",
	"—": "-",
	"―": "-",
	"−": "-",
	"…": "...",
};

const INVISIBLE = /^[­​⁠﻿]$/;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export interface NormalizedText {
	text: string;
	/** `offsets[i]` is the original UTF-16 offset of normalized character `i`; one extra entry marks the end. */
	offsets: number[];
}

export function normalizeWithOffsets(original: string): NormalizedText {
	let text = "";
	const offsets: number[] = [];
	let pendingSpace = false;
	let spaceAt = 0;
	for (const { segment, index } of graphemes.segment(original)) {
		if (/^\s+$/u.test(segment)) {
			if (!pendingSpace) spaceAt = index;
			pendingSpace = true;
			continue;
		}
		if (INVISIBLE.test(segment)) continue;
		let folded = "";
		for (const ch of segment.normalize("NFKC")) folded += FOLD[ch] ?? ch;
		folded = folded.toLowerCase();
		if (pendingSpace && text.length > 0) {
			text += " ";
			offsets.push(spaceAt);
		}
		pendingSpace = false;
		for (const ch of folded) {
			text += ch;
			for (let k = 0; k < ch.length; k++) offsets.push(index);
		}
	}
	offsets.push(original.length);
	return { text, offsets };
}

export function normalizeText(original: string): string {
	return normalizeWithOffsets(original).text;
}
