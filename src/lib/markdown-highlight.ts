/** How a stretch of composer text is styled. */
export type MarkdownStyle =
	| "marker"
	| "heading"
	| "strong"
	| "em"
	| "strike"
	| "code"
	| "link"
	| "url"
	| "quote";

/** A stretch of the draft and the styles that apply to it. */
export interface Segment {
	text: string;
	styles: MarkdownStyle[];
}

const FENCE = /^ {0,3}(```|~~~)/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^( {0,3}#{1,6}(?:[ \t]+|$))(.*)$/;
const QUOTE = /^( {0,3}>[ \t]?)(.*)$/;
const ITEM = /^([ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+)(.*)$/;

/**
 * Inline spans, earliest first. Code wins over everything inside it; the
 * others may nest.
 */
const INLINE =
	/(`+)([^`\n]*?[^`\n])\1|(\*\*|__)(?=\S)(.+?)(?<=\S)\3|(~~)(?=\S)(.+?)(?<=\S)\5|(\*|(?<![\p{L}\p{N}])_)(?=\S)(.+?)(?<=\S)\7(?![\p{L}\p{N}_])|\[([^\]\n]+)\]\(([^)\s]+)\)/gu;

function push(out: Segment[], text: string, styles: MarkdownStyle[]) {
	if (text) out.push({ text, styles });
}

function inline(out: Segment[], text: string, base: MarkdownStyle[]) {
	let at = 0;
	for (const m of text.matchAll(INLINE)) {
		push(out, text.slice(at, m.index), base);
		at = m.index + m[0].length;
		const mark = (s: string) => push(out, s, [...base, "marker"]);
		if (m[1]) {
			const style: MarkdownStyle[] = [...base, "code"];
			push(out, m[1], [...style, "marker"]);
			push(out, m[2], style);
			push(out, m[1], [...style, "marker"]);
		} else if (m[3] || m[5] || m[7]) {
			const delim = m[3] ?? m[5] ?? m[7];
			const style = m[3] ? "strong" : m[5] ? "strike" : "em";
			mark(delim);
			inline(out, m[4] ?? m[6] ?? m[8], [...base, style]);
			mark(delim);
		} else {
			mark("[");
			inline(out, m[9], [...base, "link"]);
			mark("](");
			push(out, m[10], [...base, "url"]);
			mark(")");
		}
	}
	push(out, text.slice(at), base);
}

/**
 * Splits a draft into styled segments for drawing behind the input. The
 * segments' text, joined, is always exactly the draft.
 */
export function highlightMarkdown(value: string): Segment[] {
	const out: Segment[] = [];
	let fenced: string | null = null;
	value.split("\n").forEach((line, i) => {
		if (i > 0) push(out, "\n", fenced ? ["code"] : []);
		const fence = FENCE.exec(line);
		if (fenced) {
			if (fence?.[1] === fenced) {
				push(out, line, ["code", "marker"]);
				fenced = null;
			} else push(out, line, ["code"]);
			return;
		}
		if (fence) {
			fenced = fence[1];
			push(out, line, ["code", "marker"]);
			return;
		}
		if (RULE.test(line)) {
			push(out, line, ["marker"]);
			return;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			push(out, heading[1], ["heading", "marker"]);
			inline(out, heading[2], ["heading"]);
			return;
		}
		const quote = QUOTE.exec(line);
		if (quote) {
			push(out, quote[1], ["quote", "marker"]);
			inline(out, quote[2], ["quote"]);
			return;
		}
		const item = ITEM.exec(line);
		if (item) {
			push(out, item[1], []);
			push(out, item[2], ["marker"]);
			inline(out, item[3], []);
			return;
		}
		inline(out, line, []);
	});
	return out;
}
