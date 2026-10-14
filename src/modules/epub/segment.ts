import type { Document, Element } from "domhandler";
import {
	collapse,
	elementChildren,
	isElement,
	isText,
	semanticTypes,
	textContent,
} from "./dom";
import { isExternalHref, resolveHref } from "./paths";
import type { PassageKind } from "./types";

export const MAX_PASSAGE_CHARS = 1500;

/** Elements whose content never contributes text. */
const SKIP = new Set([
	"script",
	"style",
	"head",
	"title",
	"template",
	"noscript",
	"meta",
	"link",
	"object",
	"iframe",
	"svg",
	"img",
	"video",
	"audio",
	"canvas",
	"input",
	"button",
	"select",
	"textarea",
	"hr",
]);

/** Phrasing elements: their text joins the surrounding block. */
const INLINE = new Set([
	"a",
	"abbr",
	"acronym",
	"b",
	"bdi",
	"bdo",
	"big",
	"br",
	"cite",
	"code",
	"data",
	"del",
	"dfn",
	"em",
	"font",
	"i",
	"ins",
	"kbd",
	"label",
	"mark",
	"math",
	"nobr",
	"q",
	"rp",
	"rt",
	"ruby",
	"s",
	"samp",
	"small",
	"span",
	"strike",
	"strong",
	"sub",
	"sup",
	"time",
	"tt",
	"u",
	"var",
	"wbr",
]);

/** Blocks emitted whole even when they contain nested blocks. */
const ATOMIC_KIND: Record<string, PassageKind> = {
	pre: "preformatted",
	tr: "table_row",
};

const NOTE_TYPES = new Set(["footnote", "endnote", "rearnote", "note"]);

/** Marks a hard line break until whitespace has been normalized. */
const BREAK = "";

export interface NoteLink {
	path: string;
	fragment: string;
	/** Marked with `noteref` semantics, as opposed to the superscript heuristic. */
	semantic: boolean;
}

export interface RawBlock {
	kind: PassageKind;
	text: string;
	elementId: string | null;
	/** Element path from the document root, as CFI steps (e.g. `/4/2[ch1]/6`). */
	cfiPath: string;
	/** Ids of elements inside, or immediately preceding, this block. */
	ids: string[];
	noteLinks: NoteLink[];
}

export interface SegmentOptions {
	/** Archive path of the document, for resolving links. */
	path: string;
	/** Elements to emit as single footnote passages. */
	noteElements: Set<Element>;
	/** Whether a note link points at a note; such links contribute no text. */
	isNoteTarget: (link: NoteLink) => boolean;
	segmenter: Intl.Segmenter;
}

export function isSemanticNote(el: Element): boolean {
	return semanticTypes(el).some((t) => NOTE_TYPES.has(t));
}

/** A link to a note: `noteref` semantics, or a short numeral/symbol inside or around `<sup>`. */
export function noteLinkOf(el: Element, fromPath: string): NoteLink | null {
	if (el.name !== "a") return null;
	const href = el.attribs.href;
	if (!href || isExternalHref(href)) return null;
	const target = resolveHref(fromPath, href);
	if (!target.fragment) return null;
	const semantic = semanticTypes(el).includes("noteref");
	if (!semantic) {
		const label = collapse(textContent(el));
		const marker =
			/^[[(]?(\d{1,4}|[*†‡§¶#]{1,3}|[ivxlc]{1,6}|[a-z])[\])]?$/i.test(label);
		const inSup =
			(isElement(el.parent) && el.parent.name === "sup") ||
			elementChildren(el).some((c) => c.name === "sup");
		if (!marker || !inSup) return null;
	}
	return { path: target.path, fragment: target.fragment, semantic };
}

function isInlineOnly(el: Element): boolean {
	if (!INLINE.has(el.name)) return false;
	return elementChildren(el).every((c) => SKIP.has(c.name) || isInlineOnly(c));
}

export function documentRoot(doc: Document): Element | null {
	const html = elementChildren(doc).find((e) => e.name === "html");
	return (
		(html && elementChildren(html).find((e) => e.name === "body")) ??
		html ??
		elementChildren(doc)[0] ??
		null
	);
}

/** CFI steps from the document root to `el`, e.g. `/4/2[ch1]/6`. */
export function cfiPath(el: Element): string {
	const steps: string[] = [];
	let node: Element | null = el;
	while (node && isElement(node.parent)) {
		const siblings = elementChildren(node.parent);
		const id = node.attribs.id;
		steps.push(
			`/${(siblings.indexOf(node) + 1) * 2}${id ? `[${escapeCfi(id)}]` : ""}`,
		);
		node = node.parent;
	}
	// `node` is now the root element (html), which the CFI's document step stands for.
	return steps.reverse().join("");
}

export function escapeCfi(value: string): string {
	return value.replace(/[[\]^,;()]/g, (c) => `^${c}`);
}

/**
 * Segments a content document into passages at block-level elements. Inline
 * runs that sit directly inside a container (e.g. text in a `div` next to
 * paragraphs) become their own passages. Nested blocks inside blockquotes and
 * list items inherit `quote`/`list_item`. Table rows, `pre`, and notes are
 * emitted whole.
 */
export function segmentDocument(
	root: Element,
	options: SegmentOptions,
): RawBlock[] {
	const blocks: RawBlock[] = [];
	let pendingIds: string[] = [];

	interface Run {
		parts: string[];
		ids: string[];
		noteLinks: NoteLink[];
		owner: Element;
		kind: PassageKind;
	}
	let run: Run | null = null;

	const emit = (block: Omit<RawBlock, "ids"> & { ids: string[] }) => {
		const ids = [...pendingIds, ...block.ids];
		pendingIds = [];
		const pieces = splitLongText(block.text, options.segmenter);
		pieces.forEach((text, i) => {
			blocks.push({
				...block,
				text,
				ids: i === 0 ? ids : [],
				noteLinks: i === 0 ? block.noteLinks : [],
			});
		});
	};

	const flush = () => {
		if (!run) return;
		const text = normalize(run.parts.join(""));
		if (hasText(text)) {
			emit({
				kind: run.kind,
				text,
				elementId: null,
				cfiPath: cfiPath(run.owner),
				ids: run.ids,
				noteLinks: run.noteLinks,
			});
		} else {
			pendingIds.push(...run.ids);
		}
		run = null;
	};

	/** Collects an element's full text (and ids, note links) as one block. */
	const collect = (el: Element, separator: string) => {
		const parts: string[] = [];
		const ids: string[] = [];
		const noteLinks: NoteLink[] = [];
		const visit = (node: Element) => {
			if (node.attribs.id) ids.push(node.attribs.id);
			const link = noteLinkOf(node, options.path);
			if (link) {
				noteLinks.push(link);
				// The marker (e.g. "4" in "society4") would corrupt words for search and quotes.
				if (options.isNoteTarget(link)) return;
			}
			for (const child of node.children) {
				if (isText(child)) parts.push(child.data);
				else if (isElement(child)) {
					if (SKIP.has(child.name) || isBacklink(child)) continue;
					if (child.name === "br") {
						parts.push(BREAK);
						continue;
					}
					const block = !INLINE.has(child.name);
					if (block)
						parts.push(
							child.name === "td" || child.name === "th" ? separator : BREAK,
						);
					visit(child);
					if (block && child.name !== "td" && child.name !== "th")
						parts.push(BREAK);
				}
			}
		};
		visit(el);
		return { parts, ids, noteLinks };
	};

	const emitWhole = (el: Element, kind: PassageKind) => {
		flush();
		const { parts, ids, noteLinks } = collect(el, " | ");
		let text: string;
		if (el.name === "pre") {
			text = stripInvisible(parts.join(""))
				.replaceAll(BREAK, "\n")
				.replace(/\r\n?/g, "\n")
				.replace(/^\n+/, "")
				.trimEnd();
		} else if (el.name === "tr") {
			text = normalize(parts.join("")).replace(/^\|\s*/, "");
		} else {
			text = normalize(parts.join(""));
		}
		if (!hasText(text)) {
			pendingIds.push(...ids);
			return;
		}
		emit({
			kind,
			text,
			elementId: el.attribs.id ?? null,
			cfiPath: cfiPath(el),
			ids,
			noteLinks,
		});
	};

	const walk = (container: Element, kind: PassageKind) => {
		for (const child of container.children) {
			if (isText(child)) {
				if (!run && !hasText(child.data)) continue;
				run ??= { parts: [], ids: [], noteLinks: [], owner: container, kind };
				run.parts.push(child.data);
				continue;
			}
			if (!isElement(child) || SKIP.has(child.name) || isBacklink(child))
				continue;

			if (options.noteElements.has(child)) {
				emitWhole(child, "footnote");
				continue;
			}
			const atomic = ATOMIC_KIND[child.name];
			if (atomic) {
				emitWhole(child, atomic);
				continue;
			}
			if (isInlineOnly(child)) {
				run ??= { parts: [], ids: [], noteLinks: [], owner: container, kind };
				if (child.name === "br") {
					run.parts.push(BREAK);
					continue;
				}
				const { parts, ids, noteLinks } = collect(child, " ");
				run.parts.push(...parts);
				run.ids.push(...ids);
				run.noteLinks.push(...noteLinks);
				continue;
			}

			flush();
			const childKind = blockKind(child, kind);
			if (containsBlock(child)) {
				if (child.attribs.id) pendingIds.push(child.attribs.id);
				walk(child, childKind);
				flush();
			} else {
				emitWhole(child, childKind);
			}
		}
	};

	const rootKind: PassageKind = "paragraph";
	walk(root, rootKind);
	flush();
	if (pendingIds.length > 0 && blocks.length > 0) {
		blocks.at(-1)?.ids.push(...pendingIds);
	}
	return blocks;

	function containsBlock(el: Element): boolean {
		return elementChildren(el).some(
			(c) =>
				!SKIP.has(c.name) &&
				(!isInlineOnly(c) ||
					options.noteElements.has(c) ||
					c.name in ATOMIC_KIND),
		);
	}
}

function blockKind(el: Element, inherited: PassageKind): PassageKind {
	if (/^h[1-6]$/.test(el.name) || el.name === "hgroup") return "heading";
	switch (el.name) {
		case "li":
			return "list_item";
		case "blockquote":
			return "quote";
		case "dt":
		case "dd":
			return "definition";
		default:
			return inherited;
	}
}

/** Links back from a note to its reference: navigation, not content. */
function isBacklink(el: Element): boolean {
	return el.name === "a" && semanticTypes(el).includes("backlink");
}

/**
 * Removes invisible formatting characters (soft hyphens, zero-width spaces,
 * word joiners, BOMs) that would split words for search and quote matching.
 */
function stripInvisible(text: string): string {
	return text.replace(/[­​⁠﻿]/g, "");
}

/** Collapses whitespace, keeping hard line breaks as `\n`, and strips invisible characters. */
export function normalize(text: string): string {
	return stripInvisible(text)
		.replace(/[ \t\r\n\f]+/g, " ")
		.replace(new RegExp(` *${BREAK}+ *`, "g"), (m) =>
			"\n".repeat(m.split(BREAK).length - 1),
		)
		.replace(/^[\n ]+|[\n ]+$/g, "");
}

function hasText(text: string): boolean {
	return /[^\s]/.test(text);
}

/**
 * Splits text longer than the maximum at sentence boundaries, packing whole
 * sentences into pieces of at most MAX_PASSAGE_CHARS (a single longer
 * sentence stays whole). Deterministic for a given ICU version.
 */
export function splitLongText(
	text: string,
	segmenter: Intl.Segmenter,
): string[] {
	if (text.length <= MAX_PASSAGE_CHARS) return [text];
	const pieces: string[] = [];
	let current = "";
	for (const { segment } of segmenter.segment(text)) {
		if (current && (current + segment).trimEnd().length > MAX_PASSAGE_CHARS) {
			pieces.push(current.trim());
			current = segment;
		} else {
			current += segment;
		}
	}
	if (current.trim()) pieces.push(current.trim());
	return pieces;
}
