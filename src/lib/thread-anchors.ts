// Locating a thread's anchor quote in a rendered assistant response, so its
// text can be underlined. Nothing about positions is stored: the quote is
// matched again against whatever is displayed, and a miss just means no underline.

/** Elements that start a new line in selected text, so a quote may span them with whitespace. */
const BLOCKS = new Set([
	"P",
	"LI",
	"BLOCKQUOTE",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"TR",
	"TD",
	"TH",
	"DIV",
	"PRE",
	"BR",
]);

/** Text compared with whitespace runs collapsed, as selections and markdown render it differently. */
export function normalizeQuote(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

type Point = { node: Text; offset: number } | null;

/**
 * The first place `quote` appears in the reply text inside `root`, as a DOM
 * range, or null when it is not found. Only text inside `[data-reply-source]`
 * elements counts, and citation pills and excluded content are skipped the
 * same way a selection's quote skips them.
 */
export function findQuoteRange(root: Element, quote: string): Range | null {
	const needle = normalizeQuote(quote);
	if (!needle) return null;
	let text = "";
	const points: Point[] = [];
	const space = (at: Point) => {
		if (text && !text.endsWith(" ")) {
			text += " ";
			points.push(at);
		}
	};
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			const t = node as Text;
			for (let i = 0; i < t.data.length; i++) {
				const ch = t.data[i] as string;
				if (/\s/.test(ch)) space({ node: t, offset: i });
				else {
					text += ch;
					points.push({ node: t, offset: i });
				}
			}
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const el = node as Element;
		if (
			el.hasAttribute("data-citation-status") ||
			el.hasAttribute("data-reply-excluded")
		)
			return;
		const block = BLOCKS.has(el.tagName);
		if (block) space(null);
		for (const child of Array.from(el.childNodes)) walk(child);
		if (block) space(null);
	};
	const sources = root.matches("[data-reply-source]")
		? [root]
		: Array.from(root.querySelectorAll("[data-reply-source]"));
	for (const source of sources) {
		walk(source);
		space(null);
	}
	const at = text.indexOf(needle);
	if (at === -1) return null;
	const start = points[at];
	const end = points[at + needle.length - 1];
	if (!start || !end) return null;
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset + 1);
	return range;
}

/** Whether a viewport point falls on the range's rendered text. */
export function rangeContainsPoint(range: Range, x: number, y: number) {
	for (const rect of Array.from(range.getClientRects())) {
		if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
			return true;
	}
	return false;
}
