import { parseCitationMarkers } from "./citations";

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!~>|<])/g;
// Escaped characters are parked in the private use area so the markdown rules skip them.
const PARK = 0xe000;
const PARKED = /[-]/g;

/**
 * Turns message text into a one-line plain-text preview: citation markers and
 * markdown syntax are removed and whitespace is collapsed. HTML is left as
 * literal text; the result must be rendered as a text node, never as markup.
 */
export function previewText(raw: string): string {
	let text = removeCitations(raw);
	text = text.replace(ESCAPABLE, (_, ch: string) =>
		String.fromCharCode(PARK + ch.charCodeAt(0)),
	);
	text = text
		.split("\n")
		.filter((line) => !/^\s*(`{3,}|~{3,})/.test(line))
		.filter((line) => !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line))
		.map((line) =>
			line
				.replace(/^\s{0,3}#{1,6}(\s+|$)/, "")
				.replace(/\s+#+\s*$/, "")
				.replace(/^\s*(>\s?)+/, "")
				.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/, ""),
		)
		.join("\n");
	text = text
		.replace(/(`+)([^`]*?)\1/g, "$2")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
		.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
		.replace(/(?<!\w)__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1")
		.replace(/\*(?=\S)([\s\S]*?\S)\*/g, "$1")
		.replace(/(?<!\w)_(?=\S)([\s\S]*?\S)_(?!\w)/g, "$1")
		.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
	text = text.replace(PARKED, (ch) =>
		String.fromCharCode(ch.charCodeAt(0) - PARK),
	);
	return text.replace(/\s+/g, " ").trim();
}

function removeCitations(raw: string): string {
	let out = "";
	let at = 0;
	for (const marker of parseCitationMarkers(raw)) {
		out += raw.slice(at, marker.start);
		at = marker.end;
	}
	out += raw.slice(at);
	// Stored previews are capped in SQL, which can cut a marker off before its close.
	return out.replace(/\[\[cite\b[^\]]*$/, "");
}
