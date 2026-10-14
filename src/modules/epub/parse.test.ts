import { describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { buildEpub } from "../../../test/epub-builder";
import {
	type FixtureName,
	fixtures,
	standardEbooks,
} from "../../../test/fixtures";
import {
	DRM_MESSAGE,
	EpubError,
	formatLocator,
	type ParsedEdition,
	type ParsedPassage,
	type ParsedTocEntry,
	parseEpub,
	parseLocator,
	validateEpubContainer,
} from ".";
import { MAX_PASSAGE_CHARS } from "./segment";
import { openZip } from "./zip";

const parse = async (name: FixtureName, fileName?: string) =>
	parseEpub(await fixtures[name](), { fileName });

const texts = (e: ParsedEdition, spine = 0) =>
	e.sections[spine]?.passages.map((p) => p.text) ?? [];
const all = (e: ParsedEdition): ParsedPassage[] =>
	e.sections.flatMap((s) => s.passages);
const at = (
	e: ParsedEdition,
	ref: { spineIndex: number; blockIndex: number } | null,
) => (ref ? e.sections[ref.spineIndex]?.passages[ref.blockIndex] : undefined);

async function epubError(promise: Promise<unknown>): Promise<EpubError> {
	try {
		await promise;
	} catch (err) {
		if (err instanceof EpubError) return err;
		throw err;
	}
	throw new Error("expected an EpubError");
}

describe("fixtures", () => {
	it.each(
		Object.keys(fixtures).filter(
			(n) => !["corruptZip", "notAZip", "zipSlip"].includes(n),
		),
	)("%s opens as a valid zip", async (name) => {
		const zip = await openZip(await fixtures[name as FixtureName]());
		expect(zip.names.length).toBeGreaterThan(0);
		zip.close();
	});

	it("zipSlip is a structurally valid zip with a `..` entry", async () => {
		const zip = await yauzl.fromBufferPromise(await fixtures.zipSlip(), {
			decodeStrings: false,
			lazyEntries: true,
		});
		const names: string[] = [];
		await new Promise<void>((resolve, reject) => {
			zip.on("entry", (e: yauzl.Entry) => {
				names.push(Buffer.from(e.fileName).toString());
				zip.readEntry();
			});
			zip.on("end", resolve);
			zip.on("error", reject);
			zip.readEntry();
		});
		expect(names).toContain("../evil.txt");
	});

	it("includes a Standard Ebooks EPUB", async () => {
		const zip = await openZip(standardEbooks());
		expect(zip.has("META-INF/container.xml")).toBe(true);
		zip.close();
	});
});

describe("zip reader", () => {
	it("rejects a corrupt archive", async () => {
		const err = await epubError(parseEpub(await fixtures.corruptZip()));
		expect(err.code).toBe("corrupt");
		expect(err.message).toMatch(/ZIP/);
	});

	it("rejects zip-slip paths", async () => {
		const err = await epubError(openZip(await fixtures.zipSlip()));
		expect(err.code).toBe("unsafe_path");
	});

	it("caps the total uncompressed size", async () => {
		const err = await epubError(
			openZip(await fixtures.epub3(), { maxUncompressedBytes: 100 }),
		);
		expect(err.code).toBe("too_large");
	});

	it("reports a missing package document", async () => {
		const err = await epubError(parseEpub(await fixtures.zipWithoutEpub()));
		expect(err.code).toBe("missing_package");
	});
});

describe("container validation", () => {
	it("accepts EPUBs", async () => {
		await expect(
			validateEpubContainer(await fixtures.epub3()),
		).resolves.toBeUndefined();
		await expect(
			validateEpubContainer(standardEbooks()),
		).resolves.toBeUndefined();
	});

	it.each([
		"notAZip",
		"zipWithoutEpub",
		"corruptZip",
	] as const)("rejects %s", async (name) => {
		const err = await epubError(validateEpubContainer(await fixtures[name]()));
		expect(err.code).toBe("not_epub");
		expect(err.message).toMatch(/not a valid EPUB/);
	});
});

describe("DRM detection", () => {
	it("fails on encrypted content", async () => {
		const err = await epubError(parse("drm"));
		expect(err.code).toBe("drm");
		expect(err.message).toBe(DRM_MESSAGE);
		expect(DRM_MESSAGE).toBe("DRM-protected content is not supported");
	});

	it("allows font obfuscation", async () => {
		const e = await parse("fontObfuscated");
		expect(texts(e)).toEqual(["Readable."]);
	});
});

describe("metadata", () => {
	it("reads EPUB 2 metadata, cover, and ISBN", async () => {
		const e = await parse("epub2");
		expect(e.epubVersion).toBe("2.0");
		expect(e.metadata).toEqual({
			title: "An EPUB 2 Book",
			authors: ["First Author", "Second Author"],
			language: "en",
			publisher: "Old Press",
			published: "1925-04-10",
			identifiers: [{ scheme: "ISBN", value: "9780743273565" }],
			description: "A short description.",
		});
		expect(e.cover).toMatchObject({
			path: "OEBPS/cover.png",
			mediaType: "image/png",
		});
		expect(e.cover?.data.toString()).toBe("png-bytes");
	});

	it("reads EPUB 3 metadata with authors in declared order", async () => {
		const e = await parse("epub3");
		expect(e.epubVersion).toBe("3.0");
		expect(e.metadata.title).toBe("An EPUB 3 Book");
		expect(e.metadata.authors).toEqual(["Ada Writer", "Ben Coauthor"]);
		expect(e.metadata.language).toBe("en-GB");
		expect(e.metadata.identifiers).toEqual([
			{ scheme: "UUID", value: "12345678-1234-1234-1234-123456789abc" },
			{ scheme: "15", value: "978-0-14-118263-6" },
		]);
		expect(e.cover?.path).toBe("OEBPS/images/cover.jpg");
	});

	it("falls back to the file name for a missing title", async () => {
		const e = await parse("missingTitle", "/books/Some Book.epub");
		expect(e.metadata.title).toBe("Some Book");
	});
});

describe("sections and table of contents", () => {
	it("creates one section per spine item in order, with titles from the TOC", async () => {
		const e = await parse("epub3");
		expect(e.sections.map((s) => [s.href, s.linear, s.title])).toEqual([
			["OEBPS/text/one.xhtml", true, "One"],
			["OEBPS/text/two.xhtml", true, "Two"],
			["OEBPS/text/three.xhtml", true, "Three"],
		]);
	});

	it("records non-linear spine items", async () => {
		const e = await parse("nonLinearAppendix");
		expect(e.sections.map((s) => s.linear)).toEqual([true, true, false]);
	});

	it("reads the EPUB 2 NCX", async () => {
		const e = await parse("epub2");
		expect(e.toc.map((t) => [t.label, t.depth, t.target])).toEqual([
			["Chapter One", 0, { spineIndex: 0, blockIndex: 0 }],
			["Chapter Two", 0, { spineIndex: 1, blockIndex: 0 }],
		]);
	});

	it("preserves nesting from the nav document", async () => {
		const e = await parse("nestedToc");
		const shape = (entries: ParsedTocEntry[]): unknown[] =>
			entries.map((t) => [t.label, t.depth, t.target, shape(t.children)]);
		expect(shape(e.toc)).toEqual([
			[
				"Part One",
				0,
				{ spineIndex: 0, blockIndex: 0 },
				[
					["Chapter 1", 1, { spineIndex: 1, blockIndex: 0 }, []],
					["Chapter 2", 1, { spineIndex: 2, blockIndex: 0 }, []],
				],
			],
			[
				"Part Two",
				0,
				{ spineIndex: 3, blockIndex: 0 },
				[["Chapter 3", 1, { spineIndex: 4, blockIndex: 0 }, []]],
			],
		]);
	});

	it("falls back to the NCX when an EPUB 3 has no nav document", async () => {
		const bytes = await buildEpub({
			version: 3,
			nav: false,
			ncx: true,
			chapters: [{ href: "a.xhtml", title: "Only", body: "<p>x</p>" }],
		});
		const e = await parseEpub(bytes);
		expect(e.toc.map((t) => t.label)).toEqual(["Only"]);
	});

	it("resolves fragment targets to the passage containing the element", async () => {
		const e = await parse("fragments");
		expect(texts(e)).toEqual([
			"Chapter 1",
			"One a.",
			"One b.",
			"Chapter 2",
			"Two a.",
			"Chapter 3",
			"Three a with an inline anchor.",
		]);
		expect(e.toc.map((t) => [t.label, at(e, t.target)?.text])).toEqual([
			["Chapter 1", "Chapter 1"],
			["Chapter 2", "Chapter 2"],
			["Chapter 3", "Chapter 3"],
			["Deep", "Three a with an inline anchor."],
		]);
	});
});

describe("segmentation", () => {
	it("emits block-level passages with kinds, normalized whitespace, and verse breaks", async () => {
		const e = await parse("verse");
		const passages = e.sections[0]?.passages ?? [];
		expect(passages.map((p) => [p.kind, p.text])).toEqual([
			["heading", "A Poem"],
			[
				"paragraph",
				"The woods are lovely,\ndark and deep,\nBut I have promises to keep.",
			],
			["paragraph", "Spaced out prose"],
			["paragraph", "Loose text in a div"],
			["paragraph", "then a paragraph"],
			["paragraph", "and a tail."],
			["quote", "Quoted one."],
			["quote", "Quoted two."],
			["list_item", "Item one"],
			["list_item", "Item two"],
			["table_row", "Cell A | Cell B"],
			["preformatted", "  line 1\n    line 2"],
			["definition", "Term"],
			["definition", "Definition"],
		]);
	});

	it("emits five paragraphs as five passages in order", async () => {
		const e = await parseEpub(
			await buildEpub({
				chapters: [
					{
						href: "a.xhtml",
						body: [1, 2, 3, 4, 5].map((n) => `<p>Paragraph ${n}.</p>`).join(""),
					},
				],
			}),
		);
		expect(all(e).map((p) => [p.kind, p.text])).toEqual(
			[1, 2, 3, 4, 5].map((n) => ["paragraph", `Paragraph ${n}.`]),
		);
	});

	it("splits a long block at sentence boundaries without losing text", async () => {
		const e = await parse("longParagraph");
		const passages = e.sections[0]?.passages ?? [];
		const pieces = passages.slice(1, -1);
		expect(pieces.length).toBeGreaterThan(1);
		for (const p of pieces) {
			expect(p.text.length).toBeLessThanOrEqual(MAX_PASSAGE_CHARS);
			expect(p.text).toMatch(/^Sentence number \d+ .*\.$/);
			expect(p.elementId).toBe("long");
		}
		const joined = pieces.map((p) => p.text).join(" ");
		const expected = Array.from(
			{ length: 60 },
			(_, i) =>
				`Sentence number ${i + 1} keeps the narrative moving along at a steady pace.`,
		).join(" ");
		expect(joined).toBe(expected);
		expect(passages.map((p) => p.blockIndex)).toEqual(
			passages.map((_, i) => i),
		);
	});

	it("treats every line of an hgroup as a heading", async () => {
		const e = await parseEpub(
			await buildEpub({
				chapters: [
					{
						href: "a.xhtml",
						body: "<hgroup><h2>I</h2><p>Bourgeois and Proletarians</p></hgroup><p>Body.</p>",
					},
				],
			}),
		);
		expect(all(e).map((p) => [p.kind, p.text])).toEqual([
			["heading", "I"],
			["heading", "Bourgeois and Proletarians"],
			["paragraph", "Body."],
		]);
	});

	it("strips invisible formatting characters that would split words", async () => {
		const e = await parseEpub(
			await buildEpub({
				chapters: [
					{
						href: "a.xhtml",
						body: "<p>hither&#173;to 1848&#8288;—&#8288;64 zero&#8203;width</p>",
					},
				],
			}),
		);
		expect(texts(e)).toEqual(["hitherto 1848—64 zerowidth"]);
	});

	it("keeps a single over-long sentence whole", async () => {
		const sentence = `${"word ".repeat(400)}end.`;
		const e = await parseEpub(
			await buildEpub({
				chapters: [{ href: "a.xhtml", body: `<p>${sentence}</p>` }],
			}),
		);
		expect(texts(e)).toEqual([sentence.replace(/\s+/g, " ")]);
	});
});

describe("notes", () => {
	it("turns an EPUB 3 footnote aside into one footnote passage linked from its reference", async () => {
		const e = await parse("footnotes");
		const passages = e.sections[0]?.passages ?? [];
		expect(passages.map((p) => [p.kind, p.text])).toEqual([
			["paragraph", "Plain opening paragraph."],
			["paragraph", "The green light burned."],
			["footnote", "A light at the end of a dock.\n\nSecond note paragraph."],
			["paragraph", "After the note."],
		]);
		expect(e.noteRefs).toEqual([
			{
				from: { spineIndex: 0, blockIndex: 1 },
				to: { spineIndex: 0, blockIndex: 2 },
			},
		]);
	});

	it("links endnotes in a separate document", async () => {
		const e = await parse("endnotes");
		const notes = all(e).filter((p) => p.kind === "footnote");
		expect(notes.map((n) => n.text)).toEqual([
			"The first endnote.",
			"The second endnote.",
		]);
		const linked = e.noteRefs.map(({ from, to }) => [
			at(e, from)?.text,
			at(e, to)?.text,
		]);
		expect(linked).toEqual([
			["First reference.", "The first endnote."],
			["Second reference and again.", "The second endnote."],
			["Second reference and again.", "The first endnote."],
		]);
	});

	it("detects heuristic superscript notes in non-linear documents only", async () => {
		const e = await parse("heuristicNotes");
		const note = e.sections[1]?.passages[0];
		expect(note).toMatchObject({
			kind: "footnote",
			text: "1. Heuristic note text.",
		});
		expect(e.noteRefs).toHaveLength(1);
		expect(at(e, e.noteRefs[0]?.from ?? null)?.text).toBe("Text here.");
	});

	it("finds the endnotes of the Standard Ebooks fixture", async () => {
		const e = await parseEpub(standardEbooks());
		const notes = all(e).filter((p) => p.kind === "footnote");
		expect(notes.length).toBeGreaterThan(5);
		expect(e.noteRefs.length).toBeGreaterThanOrEqual(notes.length);
		for (const { to } of e.noteRefs) expect(at(e, to)?.kind).toBe("footnote");
	});
});

describe("locators and positions", () => {
	it("formats and parses locators", () => {
		const parts = {
			shortId: "3f9a1c07b2de",
			parserVersion: 1,
			spineIndex: 12,
			blockIndex: 47,
		};
		expect(formatLocator(parts)).toBe("3f9a1c07b2de:v1:12.47");
		expect(parseLocator("3f9a1c07b2de:v1:12.47")).toEqual(parts);
		expect(parseLocator("nope")).toBeNull();
		expect(parseLocator("3f9a1c07b2de:v1:12")).toBeNull();
	});

	it("numbers linear passages contiguously across chapters", async () => {
		const e = await parse("epub3");
		const positions = e.sections.map((s) => s.passages.map((p) => p.position));
		expect(positions).toEqual([
			[1, 2, 3],
			[4, 5],
			[6, 7],
		]);
		expect(e.linearPassageCount).toBe(7);
		for (const p of all(e)) expect(p.revealPosition).toBe(p.position);
	});

	it("reveals a footnote at its first reference and unreferenced appendix text after the end", async () => {
		const e = await parse("nonLinearAppendix");
		expect(e.linearPassageCount).toBe(4);
		const appendix = e.sections[2]?.passages ?? [];
		expect(appendix.map((p) => [p.kind, p.position, p.revealPosition])).toEqual(
			[
				["heading", null, 5],
				["paragraph", null, 5],
				["footnote", null, 3],
			],
		);
		const ref = e.sections[1]?.passages[0];
		expect(ref?.position).toBe(3);
	});

	it("reveals an endnote at the earliest of several references", async () => {
		const e = await parse("endnotes");
		const notes = all(e).filter((p) => p.kind === "footnote");
		// note-1 is referenced from chapter 1 (position 2) and chapter 2 (position 3).
		expect(notes.map((n) => n.revealPosition)).toEqual([2, 3]);
	});

	it("records a CFI for every passage", async () => {
		const e = await parse("fragments");
		const cfis = all(e).map((p) => p.cfi);
		expect(cfis[0]).toBe("epubcfi(/6/2[c1]!/4/2[ch1]/2)");
		expect(cfis[4]).toBe("epubcfi(/6/2[c1]!/4/4[ch2]/4)");
		expect(new Set(cfis).size).toBe(cfis.length);
	});
});
