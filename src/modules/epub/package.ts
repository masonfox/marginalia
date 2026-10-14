import { XMLParser } from "fast-xml-parser";
import { DRM_MESSAGE, EpubError } from "./errors";
import { resolveHref } from "./paths";
import type { ZipArchive } from "./zip";

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@",
	removeNSPrefix: true,
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	textNodeName: "#text",
	isArray: (name) =>
		[
			"rootfile",
			"item",
			"itemref",
			"meta",
			"title",
			"creator",
			"identifier",
			"language",
			"publisher",
			"date",
			"description",
			"navPoint",
			"EncryptedData",
		].includes(name),
});

type XmlNode = Record<string, unknown>;

export interface ManifestItem {
	id: string;
	/** Archive path. */
	path: string;
	mediaType: string;
	properties: string[];
}

export interface SpineItem {
	idref: string;
	path: string;
	mediaType: string;
	linear: boolean;
}

export interface Identifier {
	scheme: string | null;
	value: string;
}

export interface Metadata {
	title: string | null;
	authors: string[];
	language: string | null;
	publisher: string | null;
	published: string | null;
	identifiers: Identifier[];
	description: string | null;
}

export interface PackageDocument {
	opfPath: string;
	version: string;
	metadata: Metadata;
	manifest: Map<string, ManifestItem>;
	spine: SpineItem[];
	/** Index of `<spine>` among the package element's children, for CFIs. */
	spineChildIndex: number;
	navPath: string | null;
	ncxPath: string | null;
	cover: ManifestItem | null;
}

/** Font-obfuscation algorithms, which are not DRM. */
const FONT_OBFUSCATION = new Set([
	"http://www.idpf.org/2008/embedding",
	"http://ns.adobe.com/pdf/enc#RC",
]);

export async function readPackage(zip: ZipArchive): Promise<PackageDocument> {
	if (!zip.has("META-INF/container.xml")) {
		throw new EpubError(
			"missing_package",
			"The EPUB has no META-INF/container.xml, so its package document cannot be found",
		);
	}
	const container = parse(await zip.readText("META-INF/container.xml"));
	const rootfiles = asArray(
		get(container, "container", "rootfiles", "rootfile"),
	);
	const rootfile =
		rootfiles.find(
			(r) => attr(r, "media-type") === "application/oebps-package+xml",
		) ?? rootfiles[0];
	const opfPath = rootfile ? attr(rootfile, "full-path") : null;
	if (!opfPath || !zip.has(opfPath)) {
		throw new EpubError(
			"missing_package",
			`The EPUB's package document${opfPath ? ` (${opfPath})` : ""} is missing`,
		);
	}

	const opfText = await zip.readText(opfPath);
	const opf = parse(opfText);
	const pkg = get(opf, "package") as XmlNode | undefined;
	if (!pkg) {
		throw new EpubError(
			"missing_package",
			`${opfPath} is not an OPF package document`,
		);
	}
	const version = attr(pkg, "version") ?? "2.0";

	const manifest = new Map<string, ManifestItem>();
	for (const item of asArray(get(pkg, "manifest", "item"))) {
		const id = attr(item, "id");
		const href = attr(item, "href");
		if (!id || !href) continue;
		manifest.set(id, {
			id,
			path: resolveHref(opfPath, href).path,
			mediaType: attr(item, "media-type") ?? "",
			properties: (attr(item, "properties") ?? "").split(/\s+/).filter(Boolean),
		});
	}

	const spineNode = get(pkg, "spine") as XmlNode | undefined;
	const spine: SpineItem[] = [];
	for (const ref of asArray(get(spineNode, "itemref"))) {
		const item = manifest.get(attr(ref, "idref") ?? "");
		if (!item) continue;
		spine.push({
			idref: item.id,
			path: item.path,
			mediaType: item.mediaType,
			linear: attr(ref, "linear") !== "no",
		});
	}

	const items = [...manifest.values()];
	const nav = items.find((i) => i.properties.includes("nav"));
	const tocId = attr(spineNode, "toc");
	const ncx =
		(tocId ? manifest.get(tocId) : undefined) ??
		items.find((i) => i.mediaType === "application/x-dtbncx+xml");

	const metaNode = get(pkg, "metadata") as XmlNode | undefined;
	const metas = asArray(get(metaNode, "meta"));
	const coverId = metas.find((m) => attr(m, "name") === "cover");
	const cover =
		items.find((i) => i.properties.includes("cover-image")) ??
		(coverId ? manifest.get(attr(coverId, "content") ?? "") : undefined) ??
		null;

	return {
		opfPath,
		version,
		metadata: readMetadata(metaNode, metas),
		manifest,
		spine,
		spineChildIndex: childElementIndex(opfText, "spine"),
		navPath: nav?.path ?? null,
		ncxPath: ncx?.path ?? null,
		cover: cover?.mediaType.startsWith("image/") ? cover : null,
	};
}

/**
 * Fails with the DRM reason when `META-INF/encryption.xml` declares any
 * algorithm other than font obfuscation.
 */
export async function assertNotDrmProtected(zip: ZipArchive): Promise<void> {
	if (!zip.has("META-INF/encryption.xml")) return;
	const doc = parse(await zip.readText("META-INF/encryption.xml"));
	for (const data of asArray(get(doc, "encryption", "EncryptedData"))) {
		const algorithm = attr(get(data, "EncryptionMethod"), "Algorithm");
		if (!algorithm || !FONT_OBFUSCATION.has(algorithm)) {
			throw new EpubError("drm", DRM_MESSAGE);
		}
	}
}

function readMetadata(meta: XmlNode | undefined, metas: unknown[]): Metadata {
	// EPUB 3 refinements: <meta refines="#id" property="identifier-type">ISBN</meta>
	const refinements = new Map<string, Map<string, string>>();
	for (const m of metas) {
		const refines = attr(m, "refines");
		const property = attr(m, "property");
		if (!refines || !property) continue;
		const id = refines.replace(/^#/, "");
		const map = refinements.get(id) ?? new Map<string, string>();
		map.set(property, text(m));
		refinements.set(id, map);
	}

	const identifiers: Identifier[] = [];
	for (const node of asArray(get(meta, "identifier"))) {
		const raw = text(node);
		if (!raw) continue;
		const id = attr(node, "id");
		const declared =
			attr(node, "scheme") ??
			(id ? refinements.get(id)?.get("identifier-type") : undefined);
		identifiers.push(classifyIdentifier(raw, declared ?? null));
	}

	const first = (name: string) => {
		const value = asArray(get(meta, name)).map(text).find(Boolean);
		return value || null;
	};
	const description = first("description");

	return {
		title: first("title"),
		authors: asArray(get(meta, "creator")).map(text).filter(Boolean),
		language: first("language"),
		publisher: first("publisher"),
		published: first("date"),
		identifiers,
		description: description ? stripTags(description) : null,
	};
}

function classifyIdentifier(raw: string, declared: string | null): Identifier {
	const urn = /^urn:([a-z0-9-]+):(.+)$/i.exec(raw);
	if (urn?.[1] && urn[2]) {
		return { scheme: urn[1].toUpperCase(), value: urn[2] };
	}
	const digits = raw.replace(/[-\s]/g, "");
	if (!declared && /^(97[89])?\d{9}[\dX]$/i.test(digits)) {
		return { scheme: "ISBN", value: raw };
	}
	return { scheme: declared ? declared.toUpperCase() : null, value: raw };
}

/** Position of `<name>` among the root element's child elements (0-based), by a light scan. */
function childElementIndex(xmlText: string, name: string): number {
	const body = xmlText
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<\?[\s\S]*?\?>/g, "");
	const tags = body.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/g);
	let depth = 0;
	let index = -1;
	for (const [, closing, tag, selfClosing] of tags) {
		const local = (tag ?? "").split(":").pop();
		if (closing) {
			depth--;
			continue;
		}
		if (depth === 1) {
			index++;
			if (local === name) return index;
		}
		if (!selfClosing) depth++;
	}
	return 2;
}

function parse(source: string): XmlNode {
	try {
		return xml.parse(source) as XmlNode;
	} catch (err) {
		throw new EpubError(
			"corrupt",
			`Malformed XML in the EPUB package (${String(err)})`,
			{
				cause: err,
			},
		);
	}
}

export function get(node: unknown, ...keys: string[]): unknown {
	let current = node;
	for (const key of keys) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as XmlNode)[key];
	}
	return current;
}

export function asArray(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

export function attr(node: unknown, name: string): string | null {
	const value = get(node, `@${name}`);
	return typeof value === "string" ? value : null;
}

export function text(node: unknown): string {
	if (typeof node === "string") return node.trim();
	if (typeof node === "number") return String(node);
	const value = get(node, "#text");
	return typeof value === "string" ? value.trim() : "";
}

function stripTags(value: string): string {
	return value
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
