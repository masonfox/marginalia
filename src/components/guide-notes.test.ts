// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GuideNote } from "#/modules/guide";
import {
	Attachment,
	asOfText,
	draftOf,
	NoteBody,
	newNoteDraft,
} from "./guide-notes";

const parse = (html: string) =>
	new DOMParser().parseFromString(html, "text/html");

describe("NoteBody", () => {
	it("renders Markdown but never raw HTML", () => {
		const body = [
			"**Theory**: the Shrike is _Time_ itself.",
			"",
			'<script>alert("x")</script>',
			"",
			'<img src="x" onerror="alert(1)"> and <b>bold</b> and <a href="javascript:alert(1)">link</a>',
			"",
			'<div onclick="alert(2)">block</div>',
		].join("\n");
		const doc = parse(renderToStaticMarkup(createElement(NoteBody, { body })));
		const root = doc.querySelector('[data-testid="note-body"]');
		expect(root).not.toBeNull();
		// Markdown is rendered.
		expect(root?.querySelector("strong")?.textContent).toBe("Theory");
		expect(root?.querySelector("em")?.textContent).toBe("Time");
		// Raw HTML is not: no elements, no handlers, shown as the text typed.
		for (const tag of ["script", "img", "b", "a"]) {
			expect(root?.querySelector(tag)).toBeNull();
		}
		expect(root?.querySelector("[onerror], [onclick]")).toBeNull();
		// Only the Markdown wrapper: the typed <div> is text.
		expect(root?.querySelectorAll("div")).toHaveLength(1);
		expect(root?.textContent).toContain("<b>bold</b>");
		expect(root?.textContent).toContain('<script>alert("x")</script>');
	});

	it("says when a note has no text", () => {
		expect(
			renderToStaticMarkup(createElement(NoteBody, { body: "  " })),
		).toContain("No text.");
	});
});

const note = (extra: Partial<GuideNote>): GuideNote => ({
	id: 1,
	title: "T",
	body: "B",
	asOf: { kind: "end", locator: null, position: null, label: null },
	subjectKey: null,
	unitLocator: null,
	sourceConversationId: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	subject: null,
	unit: null,
	...extra,
});

describe("asOfText", () => {
	it("names the anchor", () => {
		expect(
			asOfText({
				kind: "unit",
				locator: "a",
				position: 9,
				label: "Chapter 12",
			}),
		).toBe("As of Chapter 12");
		expect(
			asOfText({
				kind: "passage",
				locator: "a",
				position: 9,
				label: "Chapter 3",
			}),
		).toBe("As of a passage in Chapter 3");
		expect(
			asOfText({ kind: "end", locator: null, position: null, label: null }),
		).toBe("As of the end of the book");
	});
});

describe("note drafts", () => {
	it("starts a new note at the default anchor, attached to where it was opened from", () => {
		expect(newNoteDraft(null, {})).toMatchObject({
			anchor: null,
			attachment: { kind: "none" },
		});
		expect(
			newNoteDraft({ kind: "unit", endPosition: 9 }, { subject: "s:4" }),
		).toMatchObject({
			anchor: { kind: "unit", endPosition: 9 },
			attachment: { kind: "subject", ref: "s:4" },
		});
		expect(newNoteDraft({ kind: "end" }, { unit: "loc" }).attachment).toEqual({
			kind: "unit",
			unitLocator: "loc",
		});
	});

	it("edits a stored note from its anchor and attachment", () => {
		expect(
			draftOf(
				note({
					asOf: { kind: "unit", locator: "x", position: 19, label: "Two" },
					subject: { key: "brawne", ref: "s:2", name: "Brawne Lamia" },
				}),
			),
		).toMatchObject({
			anchor: { kind: "unit", endPosition: 19 },
			attachment: { kind: "subject", ref: "s:2" },
			subjectName: "Brawne Lamia",
		});
		expect(
			draftOf(
				note({
					asOf: { kind: "passage", locator: "p", position: 4, label: null },
					unit: { locator: "u", label: "One" },
				}),
			),
		).toMatchObject({
			anchor: { kind: "passage", locator: "p" },
			attachment: { kind: "unit", unitLocator: "u" },
		});
	});
});

describe("Attachment", () => {
	it("never names a subject that has no name at the bound", () => {
		for (const subject of [
			{ key: null, ref: null, name: null },
			{ key: "moneta", ref: "k:moneta", name: null },
		] as const)
			expect(
				renderToStaticMarkup(
					createElement(Attachment, {
						note: note({ subject }),
						editionId: "e",
					}),
				),
			).toBe("");
	});

	it("keeps a withheld subject attachment unsent when editing", () => {
		expect(
			draftOf(note({ subject: { key: null, ref: null, name: null } })),
		).toMatchObject({
			attachment: { kind: "subject", ref: "" },
			subjectName: "A subject not yet seen",
		});
	});
});
