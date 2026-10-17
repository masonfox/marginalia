import { describe, expect, it } from "vitest";
import {
	describeStep,
	groupParts,
	guideSteps,
	type StepKind,
	summarizeTrail,
} from "./research-trail";

const done = (type: string, input: unknown, output: unknown) => ({
	type,
	state: "output-available",
	input,
	output,
});

describe("describeStep: searchBooks", () => {
	it("shows query and count with passages", () => {
		const s = describeStep(
			done(
				"tool-searchBooks",
				{ query: "Shrike" },
				{
					status: "ok",
					count: 2,
					truncated: false,
					results: [
						{
							book: "b1",
							bookTitle: "Hyperion",
							locator: "a:v1:1.2",
							section: "Ch 1",
							position: 3,
							text: "The Shrike",
						},
						{
							book: "b1",
							bookTitle: "Hyperion",
							locator: "a:v1:1.5",
							section: "Ch 2",
							position: 9,
							text: "Tree of Pain",
						},
					],
				},
			),
		);
		expect(s).toMatchObject({
			kind: "search",
			status: "ok",
			detail: "2 results",
		});
		expect(s.label).toContain("Shrike");
		expect(s.passages[0]).toEqual({
			locator: "a:v1:1.2",
			text: "The Shrike",
			section: "Ch 1",
			bookTitle: "Hyperion",
		});
	});

	it("uses singular for one result", () => {
		const s = describeStep(
			done(
				"tool-searchBooks",
				{ query: "x" },
				{ status: "ok", count: 1, results: [{ locator: "l", text: "t" }] },
			),
		);
		expect(s.detail).toBe("1 result");
	});

	it("treats zero results as empty", () => {
		const s = describeStep(
			done(
				"tool-searchBooks",
				{ query: "x" },
				{ status: "ok", count: 0, truncated: false, results: [] },
			),
		);
		expect(s).toMatchObject({ status: "empty", detail: "no matches" });
	});

	it("fails on unknown_book with the message", () => {
		const s = describeStep(
			done(
				"tool-searchBooks",
				{ query: "x", book: "b9" },
				{
					status: "unknown_book",
					message: 'No book "b9" in this conversation.',
					books: [],
				},
			),
		);
		expect(s).toMatchObject({
			status: "failed",
			detail: 'No book "b9" in this conversation.',
		});
	});
});

describe("describeStep: readPassage", () => {
	it("labels with the joined path", () => {
		const s = describeStep(
			done(
				"tool-readPassage",
				{ locator: "a:v1:1.2" },
				{
					status: "ok",
					book: "b1",
					bookTitle: "H",
					section: "Chapter 23",
					path: ["Part Three", "Chapter 23"],
					passage: { locator: "a:v1:1.2", kind: "p", text: "Hi" },
					before: [],
					after: [],
				},
			),
		);
		expect(s.label).toBe("Part Three › Chapter 23");
		expect(s.passages).toHaveLength(1);
		expect(s.passages[0]?.locator).toBe("a:v1:1.2");
	});

	it("falls back to section, then locator", () => {
		const base = { status: "ok", passage: { locator: "l", text: "t" } };
		expect(
			describeStep(
				done(
					"tool-readPassage",
					{ locator: "l" },
					{ ...base, section: "Sec", path: [] },
				),
			).label,
		).toBe("Sec");
		expect(
			describeStep(
				done("tool-readPassage", { locator: "l" }, { ...base, path: [] }),
			).label,
		).toBe("l");
	});

	it.each([
		"not_found",
		"removed",
		"not_in_conversation",
	])("%s is unavailable", (status) => {
		const s = describeStep(
			done("tool-readPassage", { locator: "l" }, { status, locator: "l" }),
		);
		expect(s.status).toBe("unavailable");
		expect(s.passages).toEqual([]);
	});
});

describe("describeStep: readSection", () => {
	const ok = {
		status: "ok",
		superseded: false,
		book: "b1",
		bookTitle: "H",
		section: "Chapter 1",
		path: ["Part One", "Chapter 1"],
		passages: [
			{ locator: "a:v1:1.0", kind: "p", text: "One" },
			{ locator: "a:v1:1.1", kind: "p", text: "Two" },
			{ locator: "a:v1:1.2", kind: "p", text: "Three" },
		],
		truncated: true,
		next: "a:v1:1.3",
		endOfSection: false,
	};

	it("is a read step labelled with the path, listing every passage", () => {
		const s = describeStep(
			done("tool-readSection", { locator: "a:v1:1.0" }, ok),
		);
		expect(s).toMatchObject({
			kind: "read",
			status: "ok",
			label: "Part One › Chapter 1",
			detail: "3 passages",
		});
		expect(s.passages.map((p) => p.locator)).toEqual([
			"a:v1:1.0",
			"a:v1:1.1",
			"a:v1:1.2",
		]);
		expect(s.passages[1]).toEqual({
			locator: "a:v1:1.1",
			text: "Two",
			section: "Chapter 1",
			bookTitle: "H",
		});
	});

	it("falls back to section, then locator", () => {
		const base = { status: "ok", passages: [{ locator: "l", text: "t" }] };
		expect(
			describeStep(
				done(
					"tool-readSection",
					{ locator: "l" },
					{ ...base, section: "Sec", path: [] },
				),
			).label,
		).toBe("Sec");
		expect(
			describeStep(
				done("tool-readSection", { locator: "l" }, { ...base, path: [] }),
			).label,
		).toBe("l");
	});

	it.each([
		"not_found",
		"removed",
		"not_in_conversation",
	])("%s is unavailable", (status) => {
		const s = describeStep(
			done("tool-readSection", { locator: "l" }, { status, locator: "l" }),
		);
		expect(s).toMatchObject({ kind: "read", status: "unavailable" });
		expect(s.passages).toEqual([]);
	});

	it("reports in-progress as reading a section", () => {
		expect(
			describeStep({
				type: "tool-readSection",
				state: "input-available",
				input: { locator: "l" },
			}),
		).toMatchObject({
			kind: "read",
			status: "running",
			label: "Reading section…",
		});
	});

	it("skips malformed passages", () => {
		const s = describeStep(
			done(
				"tool-readSection",
				{ locator: "l" },
				{ status: "ok", passages: [null, 1, {}, { locator: "x", text: 2 }] },
			),
		);
		expect(s.passages).toEqual([
			{ locator: "x", text: "", section: undefined, bookTitle: undefined },
		]);
	});
});

describe("describeStep: other cases", () => {
	it("describes outline", () => {
		const s = describeStep(
			done("tool-getOutline", {}, { status: "ok", outlines: [] }),
		);
		expect(s).toMatchObject({
			kind: "outline",
			status: "ok",
			label: "Browsed the table of contents",
		});
	});

	it("describes unknown tools generically", () => {
		const s = describeStep(done("tool-mystery", {}, { a: 1 }));
		expect(s).toMatchObject({
			kind: "other",
			status: "ok",
			label: "Used mystery",
		});
	});

	it("reports output-error", () => {
		const s = describeStep({
			type: "tool-searchBooks",
			state: "output-error",
			input: { query: "q" },
			errorText: "boom",
		});
		expect(s).toMatchObject({ status: "failed", detail: "boom" });
	});

	it("reports in-progress without output", () => {
		expect(
			describeStep({
				type: "tool-readPassage",
				state: "input-available",
				input: { locator: "l" },
			}),
		).toMatchObject({ status: "running", label: "Reading passage…" });
	});

	it("never throws on malformed output", () => {
		const outputs = [
			null,
			"x",
			5,
			[],
			{ results: "no" },
			{ results: [null, 1, {}] },
		];
		for (const output of outputs) {
			for (const type of [
				"tool-searchBooks",
				"tool-readPassage",
				"tool-readSection",
				"tool-getOutline",
			]) {
				expect(() => describeStep(done(type, null, output))).not.toThrow();
			}
		}
	});
});

describe("groupParts / summarizeTrail", () => {
	const tool = (type = "tool-searchBooks") => ({ type });

	it("groups runs, splits at text, ignores other parts", () => {
		const blocks = groupParts([
			tool(),
			{ type: "data-citations" },
			tool("tool-readPassage"),
			{ type: "text", text: "hi" },
			tool(),
		]);
		expect(blocks.map((b) => b.type)).toEqual(["trail", "text", "trail"]);
		const first = blocks[0];
		expect(first?.type === "trail" && first.parts).toHaveLength(2);
	});

	it("does not split on empty text", () => {
		expect(
			groupParts([tool(), { type: "text", text: "" }, tool()]),
		).toHaveLength(1);
	});

	const step = (kind: StepKind, passages = 0) => ({
		kind,
		passages: Array.from({ length: passages }, (_, i) => ({
			locator: `l${i}`,
			text: "",
		})),
	});

	it("summarizes with pluralization and zero counts", () => {
		expect(
			summarizeTrail([step("search", 3), step("search"), step("read", 1)]),
		).toBe("Researched · 2 searches · 1 passage read");
		expect(summarizeTrail([step("read", 1), step("read", 1)])).toBe(
			"Researched · 2 passages read",
		);
		expect(summarizeTrail([step("search")])).toBe("Researched · 1 search");
		expect(summarizeTrail([step("outline")])).toBe("Researched");
	});

	it("counts every passage a section read returned, not just the step", () => {
		expect(summarizeTrail([step("read", 1), step("read", 24)])).toBe(
			"Researched · 25 passages read",
		);
		expect(summarizeTrail([step("read", 0)])).toBe("Researched");
	});
});

describe("guideSteps", () => {
	const entry = {
		editionId: "e1",
		scopeLabel: "Chapter 12",
		maxPosition: 120,
		mapFingerprint: "f".repeat(64),
	};
	const books = [{ editionId: "e1", title: "Hyperion" }];

	it("describes the map a reply used, through its scope", () => {
		const [step, ...rest] = guideSteps([entry], books);
		expect(rest).toEqual([]);
		expect(step).toMatchObject({
			kind: "guide",
			status: "ok",
			label: "Used chapter summaries through Chapter 12",
			guide: entry,
			passages: [],
		});
	});

	it("describes a whole-book map", () => {
		expect(
			guideSteps([{ ...entry, scopeLabel: null, maxPosition: null }], books)[0]
				?.label,
		).toBe("Used chapter summaries for the whole book");
	});

	it("names the book in a multi-book conversation, and a removed one", () => {
		const two = [...books, { editionId: "e2", title: "Endymion" }];
		expect(
			guideSteps([entry, { ...entry, editionId: "e2" }], two).map(
				(s) => s.label,
			),
		).toEqual([
			"Used chapter summaries of Hyperion through Chapter 12",
			"Used chapter summaries of Endymion through Chapter 12",
		]);
		expect(guideSteps([entry], [])[0]?.label).toBe(
			"Used chapter summaries of a removed book through Chapter 12",
		);
	});

	it("shows no guide step for older messages without context", () => {
		expect(guideSteps(null, books)).toEqual([]);
		expect(guideSteps(undefined, books)).toEqual([]);
		expect(guideSteps([], books)).toEqual([]);
		expect(guideSteps([{ editionId: 5 }, "x", null], books)).toEqual([]);
	});

	it("is excluded from the searches and passages counted", () => {
		const [guide] = guideSteps([entry], books);
		if (!guide) throw new Error("expected a guide step");
		const search = describeStep(
			done(
				"tool-searchBooks",
				{ query: "x" },
				{ status: "ok", count: 1, results: [{ locator: "a:v1:1", text: "" }] },
			),
		);
		expect(summarizeTrail([guide, search])).toBe("Researched · 1 search");
		expect(summarizeTrail([guide])).toBe("Used the book guide");
	});
});

describe("describeStep: lookupObservations", () => {
	const output = {
		status: "ok",
		book: "b1",
		subject: "Aragorn",
		message: "guide, not evidence",
		count: 4,
		truncated: false,
		results: [
			{
				unitLabel: "Chapter 1",
				observedAs: "Strider",
				kind: "character",
				source: "reader correction",
				note: "The reader's note.",
				citations: [],
			},
			{
				unitLabel: "Chapter 2",
				observedAs: "Aragorn",
				kind: "character",
				source: "generated",
				note: "Crowned.",
				citations: [],
			},
			{
				unitLabel: "Chapter 3",
				observedAs: "Strider",
				kind: "character",
				source: "generated",
				note: "Walks.",
				citations: [],
			},
			{
				unitLabel: "Chapter 3",
				observedAs: "Aragorn",
				kind: "character",
				source: "generated",
				note: "Rides.",
				citations: [],
			},
		],
	};

	it("reads as looking up the name, with the subject it resolved to and the count", () => {
		const s = describeStep(
			done("tool-lookupObservations", { book: "b1", name: "Strider" }, output),
		);
		expect(s).toMatchObject({
			kind: "observations",
			status: "ok",
			label: "Looked up “Strider” (Aragorn)",
			detail: "4 results",
			book: "b1",
			lookedUp: "Strider",
		});
		expect(s.observations).toEqual([
			{
				unitLabel: "Chapter 1",
				observedAs: "Strider",
				note: "The reader's note.",
				corrected: true,
			},
			{
				unitLabel: "Chapter 2",
				observedAs: "Aragorn",
				note: "Crowned.",
				corrected: false,
			},
			expect.objectContaining({ unitLabel: "Chapter 3", corrected: false }),
			expect.objectContaining({ observedAs: "Aragorn", note: "Rides." }),
		]);
	});

	it("omits the subject when it is the name looked up", () => {
		const s = describeStep(
			done(
				"tool-lookupObservations",
				{ book: "b1", name: "aragorn" },
				{ ...output, count: 1, results: output.results.slice(1, 2) },
			),
		);
		expect(s).toMatchObject({
			label: "Looked up “aragorn”",
			detail: "1 result",
		});
	});

	it("reads results stored before guide integration", () => {
		const s = describeStep(
			done(
				"tool-lookupObservations",
				{ book: "b1", name: "Lantern" },
				{
					status: "ok",
					count: 1,
					results: [{ unitLabel: "One", name: "Lantern", note: "Appears." }],
				},
			),
		);
		expect(s.label).toBe("Looked up “Lantern”");
		expect(s.observations).toEqual([
			{
				unitLabel: "One",
				observedAs: "Lantern",
				note: "Appears.",
				corrected: false,
			},
		]);
	});

	it("reports not found, unavailable, unknown books, progress and errors", () => {
		const step = (out: unknown) =>
			describeStep(
				done("tool-lookupObservations", { book: "b1", name: "Nobody" }, out),
			);
		expect(step({ status: "not_found", message: "none" })).toMatchObject({
			status: "empty",
			detail: "no matches",
		});
		expect(step({ status: "unavailable", message: "no" })).toMatchObject({
			status: "unavailable",
		});
		expect(
			step({ status: "unknown_book", message: "No book b9." }),
		).toMatchObject({ status: "failed", detail: "No book b9." });
		expect(
			describeStep({
				type: "tool-lookupObservations",
				state: "input-available",
				input: { name: "Nobody" },
			}),
		).toMatchObject({ status: "running", label: "Looking up “Nobody”…" });
		expect(
			describeStep({
				type: "tool-lookupObservations",
				state: "output-error",
				input: { name: "Nobody" },
				errorText: "boom",
			}),
		).toMatchObject({
			status: "failed",
			label: "Looked up “Nobody”",
			detail: "boom",
		});
	});
});

describe("describeStep: lookupNotes", () => {
	it("reads as checking the reader's notes, with the count and linkable titles", () => {
		const s = describeStep(
			done(
				"tool-lookupNotes",
				{ book: "b1" },
				{
					status: "ok",
					mode: "list",
					book: "b1",
					attribution: "the reader's own notes",
					count: 2,
					truncated: false,
					notes: [
						{ id: 7, title: "A theory", attachedTo: null, asOf: "Chapter 1" },
						{ id: 9, title: "Another", attachedTo: null, asOf: "Chapter 2" },
					],
				},
			),
		);
		expect(s).toMatchObject({
			kind: "notes",
			status: "ok",
			label: "Checked your notes",
			detail: "2 notes",
			book: "b1",
			notes: [
				{ id: 7, title: "A theory" },
				{ id: 9, title: "Another" },
			],
		});
	});

	it("names the query or subject and reports no notes", () => {
		expect(
			describeStep(
				done(
					"tool-lookupNotes",
					{ book: "b1", query: "villain" },
					{ status: "not_found", message: "No notes match within the scope." },
				),
			),
		).toMatchObject({
			label: "Checked your notes for “villain”",
			status: "empty",
			detail: "no notes",
		});
		expect(
			describeStep(
				done(
					"tool-lookupNotes",
					{ book: "b1", subject: "Shrike" },
					{
						status: "ok",
						count: 1,
						notes: [{ id: 1, title: "On the Shrike", body: "…" }],
					},
				),
			),
		).toMatchObject({
			label: "Checked your notes on “Shrike”",
			detail: "1 note",
		});
	});

	it("never throws on malformed lookup output", () => {
		for (const output of [null, "x", 5, [], { results: "no" }, { notes: [1] }])
			for (const type of ["tool-lookupObservations", "tool-lookupNotes"])
				expect(() => describeStep(done(type, null, output))).not.toThrow();
	});
});
