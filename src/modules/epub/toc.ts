import type { Element } from "domhandler";
import { XMLParser } from "fast-xml-parser";
import {
	collapse,
	elementChildren,
	findAll,
	findFirst,
	parseXhtml,
	semanticTypes,
	textContent,
} from "./dom";
import { asArray, attr, get } from "./package";
import { resolveHref } from "./paths";

export interface RawTocEntry {
	label: string;
	path: string | null;
	fragment: string | null;
	children: RawTocEntry[];
}

/** Reads the `toc` nav of an EPUB 3 navigation document. */
export function parseNav(source: string, navPath: string): RawTocEntry[] {
	const doc = parseXhtml(source);
	const navs = findAll(doc, (el) => el.name === "nav");
	const nav = navs.find((n) => semanticTypes(n).includes("toc")) ?? navs[0];
	if (!nav) return [];
	const list = findFirst(nav, (el) => el.name === "ol" || el.name === "ul");
	return list ? navList(list, navPath) : [];
}

function navList(list: Element, navPath: string): RawTocEntry[] {
	const entries: RawTocEntry[] = [];
	for (const li of elementChildren(list).filter((e) => e.name === "li")) {
		const children = elementChildren(li);
		const link = children.find((c) => c.name === "a" || c.name === "span");
		const sublist = children.find((c) => c.name === "ol" || c.name === "ul");
		const nested = sublist ? navList(sublist, navPath) : [];
		const label = link ? collapse(textContent(link)) : "";
		const href = link?.name === "a" ? link.attribs.href : undefined;
		if (!label && nested.length === 0) continue;
		const target = href ? resolveHref(navPath, href) : null;
		entries.push({
			label,
			path: target?.path ?? null,
			fragment: target?.fragment ?? null,
			children: nested,
		});
	}
	return entries;
}

const ncxParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@",
	removeNSPrefix: true,
	parseTagValue: false,
	trimValues: true,
	isArray: (name) => name === "navPoint",
});

/** Reads an EPUB 2 NCX `navMap`. */
export function parseNcx(source: string, ncxPath: string): RawTocEntry[] {
	const doc = ncxParser.parse(source);
	const toEntries = (points: unknown): RawTocEntry[] =>
		asArray(points).map((point) => {
			const label = get(point, "navLabel", "text");
			const src = attr(get(point, "content"), "src");
			const target = src ? resolveHref(ncxPath, src) : null;
			return {
				label: collapse(
					typeof label === "string" ? label : String(label ?? ""),
				),
				path: target?.path ?? null,
				fragment: target?.fragment ?? null,
				children: toEntries(get(point, "navPoint")),
			};
		});
	return toEntries(get(doc, "ncx", "navMap", "navPoint"));
}
