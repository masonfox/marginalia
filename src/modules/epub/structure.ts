import type { RawBlock } from "./segment";
import type { RawTocEntry } from "./toc";
import type {
	ParsedPassage,
	ParsedSection,
	ParsedTocEntry,
	PassageRef,
} from "./types";

export interface RawSection {
	path: string;
	linear: boolean;
	blocks: RawBlock[];
}

export interface Structure {
	sections: ParsedSection[];
	toc: ParsedTocEntry[];
	noteRefs: { from: PassageRef; to: PassageRef }[];
	linearPassageCount: number;
}

/**
 * Turns segmented sections into the edition's ordered structure: block
 * indexes, CFIs, reading positions, reveal positions, note links, TOC
 * targets, and section titles.
 */
export function buildStructure(
	rawSections: RawSection[],
	rawToc: RawTocEntry[],
	cfiBase: (spineIndex: number) => string,
): Structure {
	const idIndex = new Map<string, PassageRef>();
	let position = 0;

	const sections: ParsedSection[] = rawSections.map((raw, spineIndex) => {
		const passages = raw.blocks.map((block, blockIndex): ParsedPassage => {
			const ref = { spineIndex, blockIndex };
			for (const id of block.ids) {
				const key = `${raw.path}#${id}`;
				if (!idIndex.has(key)) idIndex.set(key, ref);
			}
			return {
				spineIndex,
				blockIndex,
				kind: block.kind,
				text: block.text,
				cfi: `epubcfi(${cfiBase(spineIndex)}!${block.cfiPath})`,
				elementId: block.elementId,
				position: raw.linear ? ++position : null,
				revealPosition: 0,
			};
		});
		return {
			spineIndex,
			href: raw.path,
			linear: raw.linear,
			title: null,
			passages,
		};
	});
	const linearPassageCount = position;
	const passageAt = (ref: PassageRef) =>
		sections[ref.spineIndex]?.passages[ref.blockIndex] as ParsedPassage;

	// Links from referencing passages to footnote passages.
	const noteRefs: { from: PassageRef; to: PassageRef }[] = [];
	const seen = new Set<string>();
	rawSections.forEach((raw, spineIndex) => {
		raw.blocks.forEach((block, blockIndex) => {
			for (const link of block.noteLinks) {
				const to = idIndex.get(`${link.path}#${link.fragment}`);
				if (!to || passageAt(to).kind !== "footnote") continue;
				if (to.spineIndex === spineIndex && to.blockIndex === blockIndex)
					continue;
				const key = `${spineIndex}.${blockIndex}>${to.spineIndex}.${to.blockIndex}`;
				if (seen.has(key)) continue;
				seen.add(key);
				noteRefs.push({ from: { spineIndex, blockIndex }, to });
			}
		});
	});

	// Reveal positions: own position for linear passages, after the end for
	// non-linear ones; referenced footnotes at their earliest reference. Notes
	// can reference notes, so iterate to a fixed point.
	for (const section of sections) {
		for (const p of section.passages) {
			p.revealPosition = p.position ?? linearPassageCount + 1;
		}
	}
	const referencedFrom = new Map<ParsedPassage, ParsedPassage[]>();
	for (const { from, to } of noteRefs) {
		const target = passageAt(to);
		referencedFrom.set(target, [
			...(referencedFrom.get(target) ?? []),
			passageAt(from),
		]);
	}
	for (let changed = true, rounds = 0; changed && rounds < 50; rounds++) {
		changed = false;
		for (const [note, refs] of referencedFrom) {
			const earliest = Math.min(...refs.map((r) => r.revealPosition));
			if (earliest !== note.revealPosition) {
				note.revealPosition = earliest;
				changed = true;
			}
		}
	}

	// TOC targets: the passage holding the fragment's element, or the first
	// passage at or after the start of the referenced section.
	const sectionIndexByPath = new Map(rawSections.map((s, i) => [s.path, i]));
	const firstPassageFrom = (spineIndex: number): PassageRef | null => {
		for (let i = spineIndex; i < sections.length; i++) {
			if ((sections[i]?.passages.length ?? 0) > 0)
				return { spineIndex: i, blockIndex: 0 };
		}
		return null;
	};
	const resolve = (entry: RawTocEntry): PassageRef | null => {
		if (!entry.path) return null;
		const spineIndex = sectionIndexByPath.get(entry.path);
		if (spineIndex === undefined) return null;
		if (entry.fragment) {
			const byId = idIndex.get(`${entry.path}#${entry.fragment}`);
			if (byId) return byId;
		}
		return firstPassageFrom(spineIndex);
	};
	const toToc = (entries: RawTocEntry[], depth: number): ParsedTocEntry[] =>
		entries.map((entry) => {
			const spineIndex = entry.path
				? sectionIndexByPath.get(entry.path)
				: undefined;
			const section =
				spineIndex === undefined ? undefined : sections[spineIndex];
			if (section && section.title === null && entry.label)
				section.title = entry.label;
			return {
				label: entry.label,
				depth,
				target: resolve(entry),
				children: toToc(entry.children, depth + 1),
			};
		});
	const toc = toToc(rawToc, 0);

	return { sections, toc, noteRefs, linearPassageCount };
}
