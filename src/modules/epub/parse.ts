import path from "node:path/posix";
import type { Element } from "domhandler";
import { findAll, isElement, parseXhtml } from "./dom";
import { EpubError } from "./errors";
import {
	assertNotDrmProtected,
	type PackageDocument,
	readPackage,
} from "./package";
import {
	documentRoot,
	escapeCfi,
	isSemanticNote,
	type NoteLink,
	noteLinkOf,
	segmentDocument,
} from "./segment";
import { buildStructure, type RawSection } from "./structure";
import { parseNav, parseNcx, type RawTocEntry } from "./toc";
import { PARSER_VERSION, type ParsedCover, type ParsedEdition } from "./types";
import { openZip, type ZipArchive } from "./zip";

export interface ParseOptions {
	/** Source file name; its base name is the title when the package declares none. */
	fileName?: string;
	maxUncompressedBytes?: number;
}

const CONTENT_TYPES = new Set([
	"application/xhtml+xml",
	"text/html",
	"application/xml",
]);

/** Containers that must never be treated as a single note. */
const NOT_NOTE_CONTAINERS = new Set([
	"body",
	"html",
	"section",
	"article",
	"main",
	"nav",
]);

/**
 * Parses an EPUB 2 or 3 file into its canonical structure. Pure apart from
 * reading the archive: the same bytes always produce the same output for a
 * given PARSER_VERSION (and ICU version, for sentence splitting).
 */
export async function parseEpub(
	source: string | Buffer,
	options: ParseOptions = {},
): Promise<ParsedEdition> {
	const zip = await openZip(source, {
		maxUncompressedBytes: options.maxUncompressedBytes,
	});
	try {
		return await parseArchive(zip, options);
	} finally {
		zip.close();
	}
}

async function parseArchive(
	zip: ZipArchive,
	options: ParseOptions,
): Promise<ParsedEdition> {
	const pkg = await readPackage(zip);
	await assertNotDrmProtected(zip);
	const warnings: string[] = [];

	const segmenter = new Intl.Segmenter(segmenterLocale(pkg.metadata.language), {
		granularity: "sentence",
	});

	// Parse every spine document up front: note detection needs links from all of them.
	const docs = await Promise.all(
		pkg.spine.map(async (item) => {
			if (
				!CONTENT_TYPES.has(item.mediaType) &&
				!/\.x?html?$/i.test(item.path)
			) {
				warnings.push(
					`Skipped non-XHTML spine item ${item.path} (${item.mediaType})`,
				);
				return null;
			}
			if (!zip.has(item.path)) {
				warnings.push(`Spine item ${item.path} is missing from the archive`);
				return null;
			}
			try {
				return documentRoot(parseXhtml(await zip.readText(item.path)));
			} catch (err) {
				warnings.push(`Could not parse ${item.path}: ${String(err)}`);
				return null;
			}
		}),
	);

	const { notes: noteElements, isNoteTarget } = findNotes(pkg, docs);

	const rawSections: RawSection[] = pkg.spine.map((item, i) => {
		const root = docs[i];
		let blocks: RawSection["blocks"] = [];
		if (root) {
			try {
				blocks = segmentDocument(root, {
					path: item.path,
					noteElements,
					isNoteTarget,
					segmenter,
				});
			} catch (err) {
				warnings.push(`Could not segment ${item.path}: ${String(err)}`);
			}
		}
		return { path: item.path, linear: item.linear, blocks };
	});

	const toc = await readToc(zip, pkg, warnings);
	const spineStep = (pkg.spineChildIndex + 1) * 2;
	const structure = buildStructure(rawSections, toc, (spineIndex) => {
		const item = pkg.spine[spineIndex];
		return `/${spineStep}/${(spineIndex + 1) * 2}[${escapeCfi(item?.idref ?? "")}]`;
	});

	return {
		parserVersion: PARSER_VERSION,
		epubVersion: pkg.version,
		metadata: {
			...pkg.metadata,
			title: pkg.metadata.title ?? titleFromFileName(options.fileName),
		},
		cover: await readCover(zip, pkg, warnings),
		...structure,
		warnings,
	};
}

/**
 * Elements to emit as footnotes: anything with note semantics, plus targets of
 * note links. Targets of `noteref` links always count; targets found only by
 * the superscript heuristic count when they sit in a non-linear section or an
 * `aside`. An inline target stands for its nearest block ancestor.
 */
function findNotes(pkg: PackageDocument, docs: (Element | null)[]) {
	const notes = new Set<Element>();
	const links: NoteLink[] = [];
	const byPath = new Map<string, { root: Element; linear: boolean }>();
	pkg.spine.forEach((item, i) => {
		const root = docs[i];
		if (!root) return;
		byPath.set(item.path, { root, linear: item.linear });
		for (const el of findAll(root, isSemanticNote)) notes.add(el);
		for (const a of findAll(root, (el) => el.name === "a")) {
			const link = noteLinkOf(a, item.path);
			if (link) links.push(link);
		}
	});

	const idCache = new Map<Element, Map<string, Element>>();
	const byId = (root: Element) => {
		let map = idCache.get(root);
		if (!map) {
			map = new Map();
			for (const el of findAll(root, (e) => Boolean(e.attribs.id))) {
				if (!map.has(el.attribs.id as string))
					map.set(el.attribs.id as string, el);
			}
			idCache.set(root, map);
		}
		return map;
	};

	const targetOf = (link: NoteLink) => {
		const doc = byPath.get(link.path);
		const target = doc && byId(doc.root).get(link.fragment);
		return doc && target ? { doc, target } : null;
	};
	for (const link of links) {
		const found = targetOf(link);
		if (!found) continue;
		const container = blockAncestor(found.target);
		if (!container || NOT_NOTE_CONTAINERS.has(container.name)) continue;
		if (link.semantic || !found.doc.linear || hasAncestor(container, "aside")) {
			notes.add(container);
		}
	}

	const noteTargets = new Set<string>();
	for (const link of links) {
		const found = targetOf(link);
		if (found && hasAncestorIn(found.target, notes)) {
			noteTargets.add(`${link.path}#${link.fragment}`);
		}
	}
	return {
		notes,
		isNoteTarget: (link: NoteLink) =>
			noteTargets.has(`${link.path}#${link.fragment}`),
	};
}

function hasAncestorIn(el: Element, set: Set<Element>): boolean {
	for (
		let node: Element | null = el;
		node;
		node = isElement(node.parent) ? node.parent : null
	) {
		if (set.has(node)) return true;
	}
	return false;
}

const INLINE_TARGETS = new Set([
	"a",
	"span",
	"sup",
	"sub",
	"b",
	"i",
	"em",
	"strong",
	"small",
]);

function blockAncestor(el: Element): Element | null {
	let node: Element | null = el;
	while (node && INLINE_TARGETS.has(node.name)) {
		node = isElement(node.parent) ? node.parent : null;
	}
	return node;
}

function hasAncestor(el: Element, name: string): boolean {
	for (
		let node: Element | null = el;
		node;
		node = isElement(node.parent) ? node.parent : null
	) {
		if (node.name === name) return true;
	}
	return false;
}

async function readToc(
	zip: ZipArchive,
	pkg: PackageDocument,
	warnings: string[],
): Promise<RawTocEntry[]> {
	if (pkg.navPath && zip.has(pkg.navPath)) {
		try {
			const entries = parseNav(await zip.readText(pkg.navPath), pkg.navPath);
			if (entries.length > 0) return entries;
		} catch (err) {
			warnings.push(`Could not read the navigation document: ${String(err)}`);
		}
	}
	if (pkg.ncxPath && zip.has(pkg.ncxPath)) {
		try {
			return parseNcx(await zip.readText(pkg.ncxPath), pkg.ncxPath);
		} catch (err) {
			warnings.push(`Could not read the NCX table of contents: ${String(err)}`);
		}
	}
	return [];
}

async function readCover(
	zip: ZipArchive,
	pkg: PackageDocument,
	warnings: string[],
): Promise<ParsedCover | null> {
	if (!pkg.cover || !zip.has(pkg.cover.path)) return null;
	try {
		return {
			path: pkg.cover.path,
			mediaType: pkg.cover.mediaType,
			data: await zip.read(pkg.cover.path),
		};
	} catch (err) {
		warnings.push(`Could not read the cover image: ${String(err)}`);
		return null;
	}
}

function titleFromFileName(fileName: string | undefined): string {
	if (!fileName) return "Untitled";
	const base = path.basename(fileName.replaceAll("\\", "/"));
	return base.replace(/\.[^.]+$/, "") || "Untitled";
}

function segmenterLocale(language: string | null): string {
	if (language) {
		try {
			const [supported] = Intl.Segmenter.supportedLocalesOf([language]);
			if (supported) return supported;
		} catch {
			// Invalid language tag: fall through to English.
		}
	}
	return "en";
}

/** Validates that a file is a ZIP with an EPUB `mimetype` or `META-INF/container.xml`. */
export async function validateEpubContainer(
	source: string | Buffer,
): Promise<void> {
	let zip: ZipArchive;
	try {
		zip = await openZip(source);
	} catch (err) {
		if (err instanceof EpubError && err.code !== "corrupt") throw err;
		throw new EpubError(
			"not_epub",
			"The file is not a valid EPUB (it is not a ZIP archive)",
			{
				cause: err,
			},
		);
	}
	try {
		const mimetype = zip.has("mimetype")
			? (await zip.readText("mimetype")).trim()
			: null;
		if (
			mimetype !== "application/epub+zip" &&
			!zip.has("META-INF/container.xml")
		) {
			throw new EpubError(
				"not_epub",
				"The file is not a valid EPUB (no EPUB mimetype or META-INF/container.xml)",
			);
		}
	} finally {
		zip.close();
	}
}
