import { buffer as readAll } from "node:stream/consumers";
import yazl from "yazl";

export interface ChapterSpec {
	href: string;
	/** Inner XHTML of `<body>`. */
	body: string;
	/** TOC label; chapters without one are left out of the default TOC. */
	title?: string;
	linear?: boolean;
	id?: string;
}

export interface TocSpec {
	label: string;
	/** Relative to the package directory, e.g. `ch1.xhtml#part2`. Omit for a heading-only entry. */
	href?: string;
	children?: TocSpec[];
}

export interface IdentifierSpec {
	value: string;
	id?: string;
	/** EPUB 2 `opf:scheme`. */
	scheme?: string;
	/** EPUB 3 `identifier-type` refinement. */
	type?: string;
}

export interface EpubSpec {
	version?: 2 | 3;
	/** `null` omits `dc:title`. */
	title?: string | null;
	creators?: string[];
	language?: string;
	publisher?: string;
	date?: string;
	description?: string;
	identifiers?: IdentifierSpec[];
	chapters: ChapterSpec[];
	toc?: TocSpec[];
	/** Include an EPUB 3 nav document (default: version 3). */
	nav?: boolean;
	/** Include an NCX (default: version 2). */
	ncx?: boolean;
	cover?: { href: string; mediaType: string; data: Buffer };
	encryption?: { algorithm: string; uri: string }[];
	extraFiles?: Record<string, string | Buffer>;
	/** Write the `mimetype` entry (default true). */
	mimetype?: boolean;
	opfDir?: string;
}

const FIXED_DATE = new Date("2000-01-01T00:00:00Z");

export function xhtml(body: string, title = "Chapter"): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title><style>p { margin: 0 }</style></head>
<body>
${body}
</body>
</html>`;
}

const esc = (s: string) =>
	s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/** Builds an EPUB in memory. Output is byte-identical for identical specs. */
export async function buildEpub(spec: EpubSpec): Promise<Buffer> {
	const version = spec.version ?? 3;
	const dir = spec.opfDir ?? "OEBPS";
	const withNav = spec.nav ?? version === 3;
	const withNcx = spec.ncx ?? version === 2;
	const toc: TocSpec[] =
		spec.toc ??
		spec.chapters
			.filter((c) => c.title)
			.map((c) => ({ label: c.title as string, href: c.href }));

	const files: [string, string | Buffer][] = [];
	files.push([
		"META-INF/container.xml",
		`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${dir}/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
	]);
	if (spec.encryption) {
		files.push([
			"META-INF/encryption.xml",
			`<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
${spec.encryption
	.map(
		(e) => `  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="${e.algorithm}"/>
    <enc:CipherData><enc:CipherReference URI="${e.uri}"/></enc:CipherData>
  </enc:EncryptedData>`,
	)
	.join("\n")}
</encryption>`,
		]);
	}

	const manifest: string[] = [];
	const spine: string[] = [];
	spec.chapters.forEach((c, i) => {
		const id = c.id ?? `c${i + 1}`;
		manifest.push(
			`<item id="${id}" href="${c.href}" media-type="application/xhtml+xml"/>`,
		);
		spine.push(
			`<itemref idref="${id}"${c.linear === false ? ' linear="no"' : ""}/>`,
		);
		files.push([`${dir}/${c.href}`, xhtml(c.body, c.title ?? "Chapter")]);
	});
	if (withNav) {
		manifest.push(
			`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
		);
		const list = (entries: TocSpec[]): string =>
			`<ol>${entries
				.map(
					(e) =>
						`<li>${e.href ? `<a href="${e.href}">${esc(e.label)}</a>` : `<span>${esc(e.label)}</span>`}${
							e.children?.length ? list(e.children) : ""
						}</li>`,
				)
				.join("")}</ol>`;
		files.push([
			`${dir}/nav.xhtml`,
			xhtml(
				`<nav epub:type="toc" id="toc"><h1>Contents</h1>${list(toc)}</nav>`,
				"Contents",
			),
		]);
	}
	if (withNcx) {
		manifest.push(
			`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
		);
		let order = 0;
		const points = (entries: TocSpec[]): string =>
			entries
				.map(
					(e) =>
						`<navPoint id="np${++order}" playOrder="${order}"><navLabel><text>${esc(e.label)}</text></navLabel><content src="${e.href ?? ""}"/>${points(e.children ?? [])}</navPoint>`,
				)
				.join("");
		files.push([
			`${dir}/toc.ncx`,
			`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="x"/></head>
<docTitle><text>${esc(spec.title ?? "")}</text></docTitle>
<navMap>${points(toc)}</navMap>
</ncx>`,
		]);
	}
	const meta: string[] = [];
	if (spec.cover) {
		const props = version === 3 ? ' properties="cover-image"' : "";
		manifest.push(
			`<item id="cover-img" href="${spec.cover.href}" media-type="${spec.cover.mediaType}"${props}/>`,
		);
		if (version === 2) meta.push(`<meta name="cover" content="cover-img"/>`);
		files.push([`${dir}/${spec.cover.href}`, spec.cover.data]);
	}

	const identifiers = spec.identifiers ?? [
		{ value: "urn:uuid:00000000-0000-0000-0000-000000000000", id: "uid" },
	];
	const dc: string[] = [];
	identifiers.forEach((ident, i) => {
		const id = ident.id ?? `id${i}`;
		const scheme = ident.scheme ? ` opf:scheme="${ident.scheme}"` : "";
		dc.push(
			`<dc:identifier id="${id}"${scheme}>${esc(ident.value)}</dc:identifier>`,
		);
		if (ident.type) {
			meta.push(
				`<meta refines="#${id}" property="identifier-type" scheme="onix:codelist5">${ident.type}</meta>`,
			);
		}
	});
	if (spec.title !== null)
		dc.push(`<dc:title>${esc(spec.title ?? "Test Book")}</dc:title>`);
	for (const c of spec.creators ?? [])
		dc.push(`<dc:creator>${esc(c)}</dc:creator>`);
	dc.push(`<dc:language>${spec.language ?? "en"}</dc:language>`);
	if (spec.publisher)
		dc.push(`<dc:publisher>${esc(spec.publisher)}</dc:publisher>`);
	if (spec.date) dc.push(`<dc:date>${spec.date}</dc:date>`);
	if (spec.description)
		dc.push(`<dc:description>${esc(spec.description)}</dc:description>`);
	if (version === 3)
		meta.push(`<meta property="dcterms:modified">2000-01-01T00:00:00Z</meta>`);

	const uid = identifiers[0]?.id ?? "id0";
	files.push([
		`${dir}/content.opf`,
		`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="${uid}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${[...dc, ...meta].join("\n")}
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine${withNcx ? ' toc="ncx"' : ""}>
${spine.join("\n")}
</spine>
</package>`,
	]);
	for (const [name, content] of Object.entries(spec.extraFiles ?? {}))
		files.push([name, content]);

	return zipFiles(files, spec.mimetype ?? true);
}

export async function zipFiles(
	files: [string, string | Buffer][],
	withMimetype = false,
): Promise<Buffer> {
	const zip = new yazl.ZipFile();
	if (withMimetype) {
		zip.addBuffer(Buffer.from("application/epub+zip"), "mimetype", {
			compress: false,
			mtime: FIXED_DATE,
		});
	}
	for (const [name, content] of files) {
		zip.addBuffer(
			typeof content === "string" ? Buffer.from(content) : content,
			name,
			{
				mtime: FIXED_DATE,
			},
		);
	}
	zip.end();
	return readAll(zip.outputStream);
}
