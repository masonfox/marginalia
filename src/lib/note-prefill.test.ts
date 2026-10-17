import { describe, expect, it } from "vitest";
import { excerptNoteDraft, quoteMarkdown } from "./note-prefill";

const conversation = { id: "c-1", title: "The Shrike" };

describe("excerptNoteDraft", () => {
	it("quotes the excerpt, links the conversation, and anchors at the scope's unit", () => {
		const draft = excerptNoteDraft({
			excerpt: "The Shrike waits.\n\nIt says nothing.",
			conversation,
			book: { editionId: "e-1", maxPosition: 120, scopeLabel: "Chapter 12" },
		});
		expect(draft).toEqual({
			editionId: "e-1",
			title: "From “The Shrike”",
			body: "> The Shrike waits.\n>\n> It says nothing.\n\nFrom the conversation [The Shrike](/c/c-1).\n\n",
			anchor: { kind: "unit", endPosition: 120 },
			anchorLabel: "Chapter 12",
			sourceConversationId: "c-1",
		});
	});

	it("anchors at the end of the book for a whole-book conversation", () => {
		const draft = excerptNoteDraft({
			excerpt: "x",
			conversation,
			book: { editionId: "e-1", maxPosition: null, scopeLabel: null },
		});
		expect(draft.anchor).toEqual({ kind: "end" });
		expect(draft.anchorLabel).toBeNull();
	});

	it("keeps the link intact whatever the conversation is called", () => {
		const draft = excerptNoteDraft({
			excerpt: "x",
			conversation: { id: "c-2", title: "a] (javascript:x) [b" },
			book: { editionId: "e-1", maxPosition: null, scopeLabel: null },
		});
		expect(draft.body).toContain("[a\\] (javascript:x) \\[b](/c/c-2)");
	});

	it("shortens a long suggested title", () => {
		const draft = excerptNoteDraft({
			excerpt: "x",
			conversation: { id: "c-3", title: "y".repeat(200) },
			book: { editionId: "e-1", maxPosition: null, scopeLabel: null },
		});
		expect(draft.title.length).toBeLessThanOrEqual(80);
	});
});

describe("quoteMarkdown", () => {
	it("quotes every line", () => {
		expect(quoteMarkdown("a\nb")).toBe("> a\n> b");
	});
});
