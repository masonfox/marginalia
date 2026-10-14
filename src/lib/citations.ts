export interface CitationMarker {
	/** The marker text exactly as the model wrote it. */
	raw: string;
	start: number;
	end: number;
	locator: string;
	quote: string;
}

const OPEN = "[[cite";
const CLOSE = "]]";

/**
 * Finds `[[cite locator="..." quote="..."]]` markers. Attribute order does not
 * matter, `\"` and `\` are unescaped inside values, unknown attributes are
 * ignored, and anything malformed (no closing, missing locator or quote,
 * unterminated value) is skipped so it renders as plain text.
 */
export function parseCitationMarkers(text: string): CitationMarker[] {
	const markers: CitationMarker[] = [];
	let from = 0;
	for (;;) {
		const start = text.indexOf(OPEN, from);
		if (start < 0) break;
		const marker = parseAt(text, start);
		if (marker) {
			markers.push(marker);
			from = marker.end;
		} else {
			from = start + OPEN.length;
		}
	}
	return markers;
}

function parseAt(text: string, start: number): CitationMarker | null {
	let i = start + OPEN.length;
	const attrs = new Map<string, string>();
	for (;;) {
		while (i < text.length && /\s/.test(text[i] as string)) i++;
		if (text.startsWith(CLOSE, i)) {
			i += CLOSE.length;
			break;
		}
		const key = /^[A-Za-z_]+/.exec(text.slice(i, i + 32))?.[0];
		if (!key) return null;
		i += key.length;
		while (text[i] === " ") i++;
		if (text[i] !== "=") return null;
		i++;
		while (text[i] === " ") i++;
		if (text[i] !== '"') return null;
		i++;
		let value = "";
		for (;;) {
			const ch = text[i];
			if (ch === undefined) return null;
			if (ch === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) {
				value += text[i + 1];
				i += 2;
				continue;
			}
			if (ch === '"') {
				i++;
				break;
			}
			value += ch;
			i++;
		}
		if (!attrs.has(key.toLowerCase())) attrs.set(key.toLowerCase(), value);
	}
	const locator = attrs.get("locator")?.trim();
	const quote = attrs.get("quote");
	if (!locator || !quote?.trim()) return null;
	return { raw: text.slice(start, i), start, end: i, locator, quote };
}

export type CitationSegment =
	| { kind: "text"; text: string }
	| { kind: "cite"; marker: CitationMarker };

/** Splits text into plain runs and parsed citation markers, in order. Malformed markers stay in the text. */
export function segmentCitations(text: string): CitationSegment[] {
	const segments: CitationSegment[] = [];
	let at = 0;
	for (const marker of parseCitationMarkers(text)) {
		if (marker.start > at) {
			segments.push({ kind: "text", text: text.slice(at, marker.start) });
		}
		segments.push({ kind: "cite", marker });
		at = marker.end;
	}
	if (at < text.length) segments.push({ kind: "text", text: text.slice(at) });
	return segments;
}

/** Parses the passage view's `hl` query value (`start-end`, character offsets) into a range. */
export function parseHighlight(
	hl: string | undefined,
): { start: number; end: number } | null {
	const m = hl ? /^(\d+)-(\d+)$/.exec(hl) : null;
	if (!m) return null;
	const start = Number(m[1]);
	const end = Number(m[2]);
	return end > start ? { start, end } : null;
}
