import type { PassageRef } from "./passage-ref";

/** The element holding a passage's text, marked `data-passage-text="<locator>"`. */
function passageTextOf(node: Node): HTMLElement | null {
	const element =
		node.nodeType === Node.ELEMENT_NODE
			? (node as Element)
			: node.parentElement;
	return element?.closest<HTMLElement>("[data-passage-text]") ?? null;
}

/**
 * A selection as a range of one passage's text, with surrounding whitespace
 * trimmed. Null unless both ends lie inside the same passage's text (never
 * its notes, a neighbouring passage, or page chrome) and something other than
 * whitespace is selected. Offsets are measured over the DOM text, which equals
 * the passage's stored text, so they hold for the passage view's `hl`.
 */
export function selectionToPassageRef(
	selection: Selection | null,
): PassageRef | null {
	if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
		return null;
	const range = selection.getRangeAt(0);
	const host = passageTextOf(range.startContainer);
	if (!host || host !== passageTextOf(range.endContainer)) return null;
	const locator = host.dataset.passageText;
	if (!locator) return null;
	const offsetOf = (container: Node, offset: number) => {
		const measure = host.ownerDocument.createRange();
		measure.setStart(host, 0);
		measure.setEnd(container, offset);
		return measure.toString().length;
	};
	const text = host.textContent ?? "";
	let start = offsetOf(range.startContainer, range.startOffset);
	let end = offsetOf(range.endContainer, range.endOffset);
	while (start < end && /\s/.test(text[start] as string)) start++;
	while (end > start && /\s/.test(text[end - 1] as string)) end--;
	if (start >= end) return null;
	return { locator, range: { start, end } };
}
