import { type ChildNode, type Document, Element, Text } from "domhandler";
import { parseDocument } from "htmlparser2";

/**
 * Parses XHTML tolerantly: HTML mode handles named entities (`&nbsp;`) and
 * malformed markup, while `recognizeSelfClosing` keeps XHTML's `<a id="x"/>`
 * from swallowing following content.
 */
export function parseXhtml(source: string): Document {
	return parseDocument(source, {
		xmlMode: false,
		recognizeSelfClosing: true,
		recognizeCDATA: true,
		decodeEntities: true,
		lowerCaseTags: true,
		lowerCaseAttributeNames: true,
	});
}

export function isElement(node: ChildNode | null | undefined): node is Element {
	return node instanceof Element;
}

export function isText(node: ChildNode | null | undefined): node is Text {
	return node instanceof Text;
}

export function elementChildren(node: { children: ChildNode[] }): Element[] {
	return node.children.filter(isElement);
}

export function findFirst(
	root: { children: ChildNode[] },
	match: (el: Element) => boolean,
): Element | null {
	for (const child of elementChildren(root)) {
		if (match(child)) return child;
		const found = findFirst(child, match);
		if (found) return found;
	}
	return null;
}

export function findAll(
	root: { children: ChildNode[] },
	match: (el: Element) => boolean,
	out: Element[] = [],
): Element[] {
	for (const child of elementChildren(root)) {
		if (match(child)) out.push(child);
		findAll(child, match, out);
	}
	return out;
}

/** Whitespace-separated tokens of `epub:type` (with or without a namespace prefix) and `role`. */
export function semanticTypes(el: Element): string[] {
	const tokens: string[] = [];
	for (const [name, value] of Object.entries(el.attribs)) {
		if (name === "epub:type" || name.endsWith(":type") || name === "role") {
			for (const t of value.split(/\s+/)) {
				if (t) tokens.push(t.replace(/^doc-/, "").toLowerCase());
			}
		}
	}
	return tokens;
}

/** Plain text content with whitespace collapsed. */
export function textContent(node: ChildNode): string {
	if (isText(node)) return node.data;
	if (isElement(node)) return node.children.map(textContent).join("");
	return "";
}

export function collapse(text: string): string {
	return text.replace(/[ \t\r\n\f]+/g, " ").trim();
}
