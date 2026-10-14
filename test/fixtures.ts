import { readFileSync } from "node:fs";
import path from "node:path";
import { buildEpub, zipFiles } from "./epub-builder";

/** The committed public-domain Standard Ebooks fixture. */
export const STANDARD_EBOOKS_PATH = path.resolve(
	"test/fixtures/standard-ebooks.epub",
);
export const standardEbooks = () => readFileSync(STANDARD_EBOOKS_PATH);

const sentence = (n: number) =>
	`Sentence number ${n} keeps the narrative moving along at a steady pace.`;

/** One fixture per parser concern. Each returns fresh EPUB bytes. */
export const fixtures = {
	epub2: () =>
		buildEpub({
			version: 2,
			title: "An EPUB 2 Book",
			creators: ["First Author", "Second Author"],
			language: "en",
			publisher: "Old Press",
			date: "1925-04-10",
			description: "<p>A <b>short</b> description.</p>",
			identifiers: [{ value: "9780743273565", id: "isbn", scheme: "ISBN" }],
			cover: {
				href: "cover.png",
				mediaType: "image/png",
				data: Buffer.from("png-bytes"),
			},
			chapters: [
				{
					href: "ch1.xhtml",
					title: "Chapter One",
					body: "<h1>Chapter One</h1><p>In my younger years.</p>",
				},
				{
					href: "ch2.xhtml",
					title: "Chapter Two",
					body: "<h1>Chapter Two</h1><p>About half way.</p>",
				},
			],
		}),

	epub3: () =>
		buildEpub({
			version: 3,
			title: "An EPUB 3 Book",
			creators: ["Ada Writer", "Ben Coauthor"],
			language: "en-GB",
			identifiers: [
				{ value: "urn:uuid:12345678-1234-1234-1234-123456789abc", id: "uid" },
				{ value: "978-0-14-118263-6", id: "isbn13", type: "15" },
			],
			cover: {
				href: "images/cover.jpg",
				mediaType: "image/jpeg",
				data: Buffer.from("jpg-bytes"),
			},
			chapters: [
				{
					href: "text/one.xhtml",
					title: "One",
					body: "<h2>One</h2><p>First.</p><p>Second.</p>",
				},
				{
					href: "text/two.xhtml",
					title: "Two",
					body: "<h2>Two</h2><p>Third.</p>",
				},
				{
					href: "text/three.xhtml",
					title: "Three",
					body: "<h2>Three</h2><p>Fourth.</p>",
				},
			],
		}),

	missingTitle: () =>
		buildEpub({
			title: null,
			chapters: [{ href: "a.xhtml", body: "<p>Untitled content.</p>" }],
		}),

	nestedToc: () =>
		buildEpub({
			chapters: [
				{ href: "part1.xhtml", body: "<h1>Part One</h1>" },
				{ href: "ch1.xhtml", body: "<h2>Chapter 1</h2><p>Alpha.</p>" },
				{ href: "ch2.xhtml", body: "<h2>Chapter 2</h2><p>Beta.</p>" },
				{ href: "part2.xhtml", body: "<h1>Part Two</h1>" },
				{ href: "ch3.xhtml", body: "<h2>Chapter 3</h2><p>Gamma.</p>" },
			],
			toc: [
				{
					label: "Part One",
					href: "part1.xhtml",
					children: [
						{ label: "Chapter 1", href: "ch1.xhtml" },
						{ label: "Chapter 2", href: "ch2.xhtml" },
					],
				},
				{
					label: "Part Two",
					href: "part2.xhtml",
					children: [{ label: "Chapter 3", href: "ch3.xhtml" }],
				},
			],
		}),

	/** Several chapters in one document, with TOC entries pointing at fragments. */
	fragments: () =>
		buildEpub({
			chapters: [
				{
					href: "chapters.xhtml",
					body: `<section id="ch1"><h2>Chapter 1</h2><p>One a.</p><p>One b.</p></section>
<section id="ch2"><h2>Chapter 2</h2><p>Two a.</p></section>
<section><h2 id="ch3">Chapter 3</h2><p>Three a <span id="deep">with an inline anchor</span>.</p></section>`,
				},
			],
			toc: [
				{ label: "Chapter 1", href: "chapters.xhtml#ch1" },
				{ label: "Chapter 2", href: "chapters.xhtml#ch2" },
				{ label: "Chapter 3", href: "chapters.xhtml#ch3" },
				{ label: "Deep", href: "chapters.xhtml#deep" },
			],
		}),

	/** EPUB 3 footnote in an aside within the chapter. */
	footnotes: () =>
		buildEpub({
			chapters: [
				{
					href: "ch1.xhtml",
					title: "Chapter 1",
					body: `<p>Plain opening paragraph.</p>
<p>The green light<a epub:type="noteref" href="#fn1" id="r1">1</a> burned.</p>
<aside epub:type="footnote" id="fn1"><p>A light at the end of a dock.</p><p>Second note paragraph.</p></aside>
<p>After the note.</p>`,
				},
			],
		}),

	/** Note references pointing to a separate endnotes document. */
	endnotes: () =>
		buildEpub({
			chapters: [
				{
					href: "ch1.xhtml",
					title: "Chapter 1",
					body: `<p>Opening.</p><p>First reference<a epub:type="noteref" href="endnotes.xhtml#note-1">1</a>.</p>`,
				},
				{
					href: "ch2.xhtml",
					title: "Chapter 2",
					body: `<p>Second reference<a epub:type="noteref" href="endnotes.xhtml#note-2">2</a> and again<a epub:type="noteref" href="endnotes.xhtml#note-1">1</a>.</p>`,
				},
				{
					href: "endnotes.xhtml",
					title: "Endnotes",
					body: `<section epub:type="endnotes"><h2>Endnotes</h2><ol>
<li id="note-1" epub:type="endnote"><p>The first endnote. <a href="ch1.xhtml" epub:type="backlink">↩</a></p></li>
<li id="note-2" epub:type="endnote"><p>The second endnote.</p></li>
</ol></section>`,
				},
			],
		}),

	/** Endnotes found only by the superscript heuristic, in a non-linear document. */
	heuristicNotes: () =>
		buildEpub({
			chapters: [
				{
					href: "ch1.xhtml",
					title: "Chapter 1",
					body: `<p>Text<sup><a href="notes.xhtml#n1">1</a></sup> here.</p><p>See <a href="ch1.xhtml#x">a cross reference</a>.</p>`,
				},
				{
					href: "notes.xhtml",
					linear: false,
					body: `<p id="n1"><a href="ch1.xhtml">1.</a> Heuristic note text.</p>`,
				},
			],
		}),

	verse: () =>
		buildEpub({
			chapters: [
				{
					href: "poem.xhtml",
					title: "Poem",
					body: `<h2>A   Poem</h2>
<p class="verse">The woods are lovely,<br/>dark   and deep,<br />
   But I have promises to keep.</p>
<p>  Spaced
   out
   prose  </p>
<p>&#160;</p><p>   </p>
<script>var x = "not text";</script>
<div>Loose text in a div <p>then a paragraph</p> and a tail.</div>
<blockquote><p>Quoted one.</p><p>Quoted two.</p></blockquote>
<ul><li>Item one</li><li><p>Item two</p></li></ul>
<table><tr><td>Cell A</td><td>Cell B</td></tr></table>
<pre>  line 1
    line 2</pre>
<dl><dt>Term</dt><dd>Definition</dd></dl>`,
				},
			],
		}),

	longParagraph: () =>
		buildEpub({
			chapters: [
				{
					href: "long.xhtml",
					title: "Long",
					body: `<p>Short opener.</p><p id="long">${Array.from({ length: 60 }, (_, i) => sentence(i + 1)).join(" ")}</p><p>Closer.</p>`,
				},
			],
		}),

	/** A referenced footnote in an appendix plus unreferenced appendix content, both non-linear. */
	nonLinearAppendix: () =>
		buildEpub({
			chapters: [
				{
					href: "ch1.xhtml",
					title: "Chapter 1",
					body: "<p>One.</p><p>Two.</p>",
				},
				{
					href: "ch2.xhtml",
					title: "Chapter 2",
					body: `<p>Three<a epub:type="noteref" href="appendix.xhtml#an1">*</a>.</p><p>Four.</p>`,
				},
				{
					href: "appendix.xhtml",
					title: "Appendix",
					linear: false,
					body: `<h2>Appendix</h2><p>Unreferenced appendix text.</p><aside epub:type="footnote" id="an1"><p>Appendix note.</p></aside>`,
				},
			],
		}),

	drm: () =>
		buildEpub({
			chapters: [{ href: "a.xhtml", body: "<p>Encrypted.</p>" }],
			encryption: [
				{
					algorithm: "http://www.w3.org/2001/04/xmlenc#aes128-cbc",
					uri: "OEBPS/a.xhtml",
				},
			],
		}),

	fontObfuscated: () =>
		buildEpub({
			chapters: [{ href: "a.xhtml", body: "<p>Readable.</p>" }],
			encryption: [
				{
					algorithm: "http://www.idpf.org/2008/embedding",
					uri: "OEBPS/fonts/f.otf",
				},
			],
			extraFiles: { "OEBPS/fonts/f.otf": Buffer.from("font") },
		}),

	corruptZip: async () => {
		const good = await buildEpub({
			chapters: [{ href: "a.xhtml", body: "<p>x</p>" }],
		});
		return Buffer.concat([
			Buffer.from("PK\x03\x04garbage"),
			good.subarray(200, 400),
		]);
	},

	notAZip: async () => Buffer.from("%PDF-1.7 this is not an epub"),

	zipWithoutEpub: () => zipFiles([["readme.txt", "hello"]]),

	/** An entry named `../evil.txt` (written as `aa/evil.txt`, then patched). */
	zipSlip: async () => {
		const zip = await zipFiles([
			["META-INF/container.xml", "<container/>"],
			["aa/evil.txt", "pwned"],
		]);
		const from = Buffer.from("aa/evil.txt");
		const to = Buffer.from("../evil.txt");
		let at = zip.indexOf(from);
		while (at >= 0) {
			to.copy(zip, at);
			at = zip.indexOf(from, at + 1);
		}
		return zip;
	},
};

export type FixtureName = keyof typeof fixtures;
