import { describe, expect, it } from "vitest";
import { passageContextPart } from "#/lib/passage-ref";
import { projectThreadAnchor } from "./thread-context";

const anchor = {
	messageId: "00000000-0000-4000-8000-000000000001",
	quote: "the green light",
};

describe("projectThreadAnchor", () => {
	it("puts the labelled anchor quote before the reader's text", () => {
		const parts = [{ type: "text", text: "Why green?" }];
		const projected = projectThreadAnchor(parts, anchor) as {
			type: string;
			text: string;
		}[];
		expect(projected).toHaveLength(2);
		expect(projected[0]?.text).toContain("Side thread about this excerpt");
		expect(projected[0]?.text).toContain("not verified book evidence");
		expect(projected[0]?.text).toContain(
			"<thread-anchor-quote>\nthe green light\n</thread-anchor-quote>",
		);
		expect(projected[1]).toEqual(parts[0]);
		// The stored parts are untouched.
		expect(parts).toEqual([{ type: "text", text: "Why green?" }]);
	});

	it("projects a passage reference after the anchor, in a fixed order", () => {
		const parts = [
			passageContextPart({
				locator: "0123456789ab:v1:0.0",
				editionId: "00000000-0000-4000-8000-000000000002",
				bookTitle: "Book",
				sectionTitle: null,
				text: "A passage.",
			}),
			{ type: "text", text: "Compare this" },
		];
		const texts = (
			projectThreadAnchor(parts, anchor) as { type: string; text: string }[]
		).map((p) => p.text);
		expect(texts).toHaveLength(3);
		expect(texts[0]).toContain("<thread-anchor-quote>");
		expect(texts[1]).toContain("<referenced-passage");
		expect(texts[2]).toBe("Compare this");
	});
});
