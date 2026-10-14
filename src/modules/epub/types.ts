import type { Identifier } from "./package";

/**
 * Bump whenever parser output (segmentation, text, ordering) could change for
 * any input. Locators embed it, and reparsing an edition forwards old locators.
 */
export const PARSER_VERSION = 1;

export const passageKinds = [
	"heading",
	"paragraph",
	"quote",
	"list_item",
	"preformatted",
	"table_row",
	"definition",
	"footnote",
] as const;
export type PassageKind = (typeof passageKinds)[number];

export interface PassageRef {
	spineIndex: number;
	blockIndex: number;
}

export interface ParsedPassage extends PassageRef {
	kind: PassageKind;
	text: string;
	cfi: string;
	elementId: string | null;
	/** Reading-order position (1-based); null in non-linear sections. */
	position: number | null;
	revealPosition: number;
}

export interface ParsedSection {
	spineIndex: number;
	/** Archive path of the content document. */
	href: string;
	linear: boolean;
	title: string | null;
	passages: ParsedPassage[];
}

export interface ParsedTocEntry {
	label: string;
	depth: number;
	target: PassageRef | null;
	children: ParsedTocEntry[];
}

export interface ParsedMetadata {
	title: string;
	authors: string[];
	language: string | null;
	publisher: string | null;
	published: string | null;
	identifiers: Identifier[];
	description: string | null;
}

export interface ParsedCover {
	path: string;
	mediaType: string;
	data: Buffer;
}

export interface ParsedEdition {
	parserVersion: number;
	epubVersion: string;
	metadata: ParsedMetadata;
	cover: ParsedCover | null;
	sections: ParsedSection[];
	toc: ParsedTocEntry[];
	noteRefs: { from: PassageRef; to: PassageRef }[];
	linearPassageCount: number;
	/** Recoverable problems, e.g. a content document that could not be parsed. */
	warnings: string[];
}
