import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { standardEbooks } from "../../../test/fixtures";
import { formatLocator, PARSER_VERSION, parseEpub } from ".";

/**
 * Pins locators and text for the committed fixture. If this fails after a
 * parser change, the change alters locators: bump PARSER_VERSION (which
 * starts a new golden file) rather than editing the existing one.
 */
describe("golden parse of the Standard Ebooks fixture", () => {
	it("is byte-identical across parses of the same bytes", async () => {
		const bytes = standardEbooks();
		const a = await parseEpub(bytes);
		const b = await parseEpub(Buffer.from(bytes));
		expect(JSON.stringify(b)).toBe(JSON.stringify(a));
	});

	it("matches the snapshot for this parser version", async () => {
		const bytes = standardEbooks();
		const shortId = createHash("sha256")
			.update(bytes)
			.digest("hex")
			.slice(0, 12);
		const edition = await parseEpub(bytes);
		const passages = edition.sections.flatMap((s) =>
			s.passages.map((p) => ({
				locator: formatLocator({
					shortId,
					parserVersion: PARSER_VERSION,
					...p,
				}),
				kind: p.kind,
				position: p.position,
				reveal: p.revealPosition,
				text: p.text,
			})),
		);
		const golden = {
			parserVersion: PARSER_VERSION,
			metadata: edition.metadata,
			sections: edition.sections.map((s) => ({
				href: s.href,
				linear: s.linear,
				title: s.title,
				passages: s.passages.length,
			})),
			toc: edition.toc,
			noteRefs: edition.noteRefs,
			linearPassageCount: edition.linearPassageCount,
			passages,
		};
		await expect(`${JSON.stringify(golden, null, "\t")}\n`).toMatchFileSnapshot(
			`../../../test/fixtures/standard-ebooks.v${PARSER_VERSION}.golden.json`,
		);
	});
});
