import { and, asc, between, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { saveUnitResult, type UnitResult } from "#/modules/analysis";
import { getReadingUnits, passages, type ReadingUnit } from "#/modules/catalog";
import {
	conversationEditions,
	createConversationForEdition,
	deleteConversation,
} from "#/modules/conversation";
import { type ParsedEdition, parseEpub } from "#/modules/epub";
import { deleteEdition } from "#/modules/library";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import { ingestBook, silentLog, tempDataDir } from "../../../test/library";
import {
	countReaderContent,
	createNote,
	defaultNoteAnchor,
	deleteNote,
	getGuideChapters,
	getGuideNote,
	getGuideSubject,
	getUnitAnchors,
	listGuideNotes,
	listNotes,
	listSubjectNotes,
	MAX_NOTE_BODY,
	MAX_NOTE_TITLE,
	mergeSubjects,
	type NoteInput,
	readerNotes,
	resolveSubjects,
	saveCorrection,
	setReadingPosition,
	updateNote,
} from ".";

let t: TestDb;
let dataDir: string;
let parsed: ParsedEdition;
let units: ReadingUnit[];
let names = 0;

/** A new ready edition of the nested-TOC fixture (three units). */
async function book() {
	const bytes = await fixtures.nestedToc();
	const { id } = await ingestBook(
		t.db,
		dataDir,
		Buffer.concat([bytes, Buffer.from(`${names++}`)]),
		`notes-${names}.epub`,
		{ parse: async () => parsed },
	);
	return id;
}

beforeAll(async () => {
	t = await createTestDb();
	dataDir = await tempDataDir();
	parsed = await parseEpub(await fixtures.nestedToc());
	units = await getReadingUnits(t.db, await book());
	expect(units).toHaveLength(3);
});

const u = (i: number) => units[i] as ReadingUnit;
const through = (i: number) => ({
	kind: "unit" as const,
	endPosition: u(i).endPosition,
});
const whole = { kind: "whole" } as const;

/** Unit `i`'s anchor in edition `id`: locators differ per edition. */
async function startOf(id: string, i: number) {
	const unit = (await getReadingUnits(t.db, id))[i];
	if (!unit) throw new Error(`no unit ${i}`);
	return unit.startLocator;
}

/** The passages of unit `i`, in reading order. */
async function unitPassages(id: string, i: number) {
	return t.db
		.select({
			locator: passages.locator,
			position: passages.revealPosition,
		})
		.from(passages)
		.where(
			and(
				eq(passages.editionId, id),
				between(passages.position, u(i).startPosition, u(i).endPosition),
			),
		)
		.orderBy(asc(passages.position));
}

const note = (title: string, extra: Partial<NoteInput> = {}): NoteInput => ({
	title,
	body: `About ${title}.`,
	...extra,
});

/** Creates a note and returns it, failing the test when it is refused. */
async function created(id: string, input: NoteInput) {
	const result = await createNote(t.db, id, input);
	if (!result.ok) throw new Error(`refused: ${result.reason}`);
	return result.note;
}

const titles = (notes: { title: string }[]) => notes.map((n) => n.title);

describe("note limits", () => {
	it("accepts a title and body at their limits", async () => {
		const id = await book();
		const result = await createNote(t.db, id, {
			title: "T".repeat(MAX_NOTE_TITLE),
			body: "B".repeat(MAX_NOTE_BODY),
			anchor: { kind: "end" },
		});
		expect(result.ok).toBe(true);
		expect(MAX_NOTE_TITLE).toBe(200);
		expect(MAX_NOTE_BODY).toBe(20_000);
	});

	it("rejects a title over 200 characters with the limit stated", async () => {
		const id = await book();
		const result = await createNote(t.db, id, {
			title: "T".repeat(201),
			body: "",
			anchor: { kind: "end" },
		});
		expect(result).toEqual({
			ok: false,
			reason: "too_long",
			field: "title",
			limit: 200,
			message: expect.stringContaining("200"),
		});
	});

	it("rejects a body over 20,000 characters with the limit stated, on create and update", async () => {
		const id = await book();
		const long = { body: "B".repeat(20_001), anchor: { kind: "end" } as const };
		const refusal = {
			ok: false,
			reason: "too_long",
			field: "body",
			limit: 20_000,
			message: expect.stringContaining("20,000"),
		};
		expect(await createNote(t.db, id, { title: "Long", ...long })).toEqual(
			refusal,
		);
		const saved = await created(id, note("Short", { anchor: { kind: "end" } }));
		expect(
			await updateNote(t.db, id, saved.id, { title: "Short", ...long }),
		).toEqual(refusal);
		expect((await getGuideNote(t.db, id, whole, saved.id)).ok).toBe(true);
		const [stored] = await listNotes(t.db, id, null);
		expect(stored?.body).toBe("About Short.");
		expect(
			await t.db
				.select()
				.from(readerNotes)
				.where(eq(readerNotes.editionId, id)),
		).toHaveLength(1);
	});

	it("rejects a blank title", async () => {
		const id = await book();
		expect(
			await createNote(t.db, id, {
				title: "   ",
				body: "x",
				anchor: { kind: "end" },
			}),
		).toMatchObject({ ok: false, reason: "empty_title" });
	});
});

describe("default anchors", () => {
	it("defaults to the reading position's unit", async () => {
		const id = await book();
		await setReadingPosition(t.db, id, through(1));
		expect(await defaultNoteAnchor(t.db, id)).toEqual({
			choice: { kind: "unit", endPosition: u(1).endPosition },
			label: u(1).label,
		});
		const saved = await created(id, note("Who is the Shrike?"));
		const last = (await unitPassages(id, 1)).at(-1);
		expect(saved.asOf).toEqual({
			kind: "unit",
			locator: last?.locator,
			position: u(1).endPosition,
			label: u(1).label,
		});
	});

	it("defaults to the end of the book once the position is finished", async () => {
		const id = await book();
		await setReadingPosition(t.db, id, { kind: "whole" });
		expect(await defaultNoteAnchor(t.db, id)).toEqual({
			choice: { kind: "end" },
			label: null,
		});
		const saved = await created(id, note("Theory"));
		expect(saved.asOf).toEqual({
			kind: "end",
			locator: null,
			position: null,
			label: null,
		});
	});

	it("makes the reader choose when the position is unset", async () => {
		const id = await book();
		expect(await defaultNoteAnchor(t.db, id)).toBeNull();
		expect(await createNote(t.db, id, note("Unanchored"))).toMatchObject({
			ok: false,
			reason: "anchor_required",
		});
		const chosen = await created(
			id,
			note("Anchored", {
				anchor: { kind: "unit", endPosition: u(0).endPosition },
			}),
		);
		expect(chosen.asOf.label).toBe(u(0).label);
	});

	it("anchors at a passage, in the unit holding it, and refuses a stale anchor", async () => {
		const id = await book();
		const [, middle] = await unitPassages(id, 2);
		if (!middle) throw new Error("expected a second passage");
		const saved = await created(
			id,
			note("Here", { anchor: { kind: "passage", locator: middle.locator } }),
		);
		expect(saved.asOf).toEqual({
			kind: "passage",
			locator: middle.locator,
			position: middle.position,
			label: u(2).label,
		});
		expect(
			await createNote(
				t.db,
				id,
				note("Off", {
					anchor: { kind: "unit", endPosition: u(2).endPosition - 1 },
				}),
			),
		).toMatchObject({ ok: false, reason: "stale_anchor" });
		expect(
			await createNote(
				t.db,
				id,
				note("Elsewhere", {
					anchor: { kind: "passage", locator: "zzzzzzzzzzzz:v1:0.0" },
				}),
			),
		).toMatchObject({ ok: false, reason: "stale_anchor" });
	});
});

describe("note edits", () => {
	it("updates title, body, anchor and attachment, keeping what is omitted, and deletes", async () => {
		const id = await book();
		const saved = await created(
			id,
			note("Draft", {
				anchor: { kind: "unit", endPosition: u(0).endPosition },
				attachment: { kind: "unit", unitLocator: await startOf(id, 0) },
			}),
		);
		const kept = await updateNote(t.db, id, saved.id, {
			title: " Final ",
			body: "**Bold** claim.",
		});
		expect(kept.ok && kept.note).toMatchObject({
			title: "Final",
			body: "**Bold** claim.",
			asOf: saved.asOf,
			unitLocator: saved.unitLocator,
		});
		const moved = await updateNote(t.db, id, saved.id, {
			title: "Final",
			body: "",
			anchor: { kind: "end" },
			attachment: { kind: "none" },
		});
		expect(moved.ok && moved.note).toMatchObject({
			asOf: { kind: "end", locator: null, position: null, label: null },
			unitLocator: null,
			subjectKey: null,
		});
		expect(await deleteNote(t.db, id, saved.id)).toBe(true);
		expect(await deleteNote(t.db, id, saved.id)).toBe(false);
		expect(
			await updateNote(t.db, id, saved.id, { title: "Gone", body: "" }),
		).toMatchObject({ ok: false, reason: "not_found" });
	});

	it("refuses an attachment to a unit or subject the book does not have", async () => {
		const id = await book();
		const [, second] = await unitPassages(id, 0);
		if (!second) throw new Error("expected a second passage");
		for (const attachment of [
			{ kind: "unit", unitLocator: second.locator },
			{ kind: "subject", ref: "k:nobody" },
			{ kind: "subject", ref: "s:999999" },
			{ kind: "subject", ref: "bogus" },
		] as const) {
			expect(
				await createNote(
					t.db,
					id,
					note("X", { anchor: { kind: "end" }, attachment }),
				),
			).toMatchObject({ ok: false, reason: "stale_attachment" });
		}
	});

	it("keeps the conversation a note was saved from until that conversation is deleted", async () => {
		const id = await book();
		const conversation = await createConversationForEdition(t.db, id, {
			kind: "whole",
		});
		if (!conversation || "error" in conversation)
			throw new Error("expected a conversation");
		const saved = await created(
			id,
			note("Saved", {
				anchor: { kind: "end" },
				sourceConversationId: conversation.id,
			}),
		);
		expect(saved.sourceConversationId).toBe(conversation.id);
		const edited = await updateNote(t.db, id, saved.id, {
			title: "Saved",
			body: "Edited.",
		});
		expect(edited.ok && edited.note.sourceConversationId).toBe(conversation.id);
		await deleteConversation(t.db, conversation.id);
		const [after] = await listNotes(t.db, id, null);
		expect(after?.sourceConversationId).toBeNull();
	});
});

describe("bounded visibility", () => {
	it("shows a note only at bounds at or after its anchor, and an end-of-book note only for the whole book", async () => {
		const id = await book();
		const [, middle] = await unitPassages(id, 1);
		if (!middle) throw new Error("expected a second passage");
		await created(
			id,
			note("Chapter one", {
				anchor: { kind: "unit", endPosition: u(0).endPosition },
			}),
		);
		await created(
			id,
			note("Mid two", { anchor: { kind: "passage", locator: middle.locator } }),
		);
		await created(
			id,
			note("Chapter three", {
				anchor: { kind: "unit", endPosition: u(2).endPosition },
			}),
		);
		await created(
			id,
			note("Theory written after finishing", { anchor: { kind: "end" } }),
		);

		// Guide bounds: a unit's end, or the whole book.
		const guide = async (choice: typeof whole | ReturnType<typeof through>) => {
			const result = await listGuideNotes(t.db, id, choice);
			if (!result.ok) throw new Error(result.reason);
			return titles(result.notes);
		};
		expect(await guide(through(0))).toEqual(["Chapter one"]);
		expect(await guide(through(1))).toEqual(["Chapter one", "Mid two"]);
		expect(await guide(through(2))).toEqual([
			"Chapter one",
			"Mid two",
			"Chapter three",
		]);
		expect(await guide(whole)).toEqual([
			"Chapter one",
			"Mid two",
			"Chapter three",
			"Theory written after finishing",
		]);

		// A passage bound: the passage on screen, inside a unit.
		expect(titles(await listNotes(t.db, id, middle.position - 1))).toEqual([
			"Chapter one",
		]);
		expect(titles(await listNotes(t.db, id, middle.position))).toEqual([
			"Chapter one",
			"Mid two",
		]);

		// A conversation's bound for this book, as stored with its scope.
		const conversationBound = async (
			scope: { kind: "whole" } | ReturnType<typeof through>,
		) => {
			const conversation = await createConversationForEdition(t.db, id, scope);
			if (!conversation || "error" in conversation)
				throw new Error("expected a conversation");
			const [row] = await t.db
				.select({ maxPosition: conversationEditions.maxPosition })
				.from(conversationEditions)
				.where(eq(conversationEditions.conversationId, conversation.id));
			return row?.maxPosition ?? null;
		};
		const scoped = await conversationBound(through(1));
		expect(titles(await listNotes(t.db, id, scoped))).toEqual([
			"Chapter one",
			"Mid two",
		]);
		// The theory written after finishing stays hidden from any partial scope.
		expect(
			titles(await listNotes(t.db, id, await conversationBound(through(2)))),
		).not.toContain("Theory written after finishing");
		expect(
			titles(await listNotes(t.db, id, await conversationBound(whole))),
		).toContain("Theory written after finishing");
	});

	it("does not return a note beyond the bound by id", async () => {
		const id = await book();
		const later = await created(
			id,
			note("Later", {
				anchor: { kind: "unit", endPosition: u(2).endPosition },
			}),
		);
		const early = await getGuideNote(t.db, id, through(1), later.id);
		expect(early.ok && early.note).toBeNull();
		const now = await getGuideNote(t.db, id, through(2), later.id);
		expect(now.ok && now.note?.title).toBe("Later");
		expect(
			await getGuideNote(t.db, id, { kind: "unit", endPosition: -5 }, later.id),
		).toEqual({
			ok: false,
			reason: "stale_bound",
		});
	});
});

/** A unit result for unit `i`, observing each name. */
const result = (i: number, seen: string[]) =>
	({
		unitOrdinal: i,
		unitLabel: u(i).label,
		endPosition: u(i).endPosition,
		summary: `Summary ${i}`,
		summaryCitations: [],
		observations: seen.map((name) => ({
			name,
			kind: "character" as const,
			note: `${name} in ${i}`,
			citations: [],
		})),
		model: "m",
	}) satisfies UnitResult;

describe("attached notes", () => {
	it("lists a subject's notes through the aliases visible at the bound", async () => {
		const id = await book();
		await saveUnitResult(t.db, id, result(0, ["Brawne Lamia"]));
		await saveUnitResult(t.db, id, result(1, ["Brawne"]));
		await saveUnitResult(t.db, id, result(2, ["Brawne"]));
		// "Brawne" is revealed as Brawne Lamia from the end of unit 2.
		const merged = await mergeSubjects(t.db, id, whole, {
			targetRef: "k:brawne lamia",
			sourceRef: "k:brawne",
			reveal: { kind: "unit", endPosition: u(2).endPosition },
		});
		if (!merged.ok) throw new Error(merged.reason);
		const end = {
			anchor: { kind: "unit" as const, endPosition: u(1).endPosition },
		};
		const onFull = await created(
			id,
			note("On Lamia", {
				...end,
				attachment: { kind: "subject", ref: merged.ref },
			}),
		);
		expect(onFull.subjectKey).toBe("brawne lamia");
		await created(
			id,
			note("On Brawne", {
				...end,
				attachment: { kind: "subject", ref: "k:brawne" },
			}),
		);
		await created(id, note("Unattached", end));

		const anchors = await getUnitAnchors(t.db, id);
		const notesOf = async (ref: string, bound: number | null) =>
			titles(
				await listSubjectNotes(
					t.db,
					id,
					ref,
					bound,
					await resolveSubjects(t.db, id, bound, anchors),
				),
			);
		// Before the reveal, each name is its own subject, with its own notes.
		expect(await notesOf(merged.ref, u(1).endPosition)).toEqual(["On Lamia"]);
		expect(await notesOf("k:brawne", u(1).endPosition)).toEqual(["On Brawne"]);
		// From the reveal on, the subject has the notes of both names.
		expect((await notesOf(merged.ref, u(2).endPosition)).sort()).toEqual([
			"On Brawne",
			"On Lamia",
		]);
		expect((await notesOf(merged.ref, null)).sort()).toEqual([
			"On Brawne",
			"On Lamia",
		]);
		expect(await notesOf("k:brawne", null)).toEqual([]);

		// The timeline shows them, and the Notes view lists every note.
		const timeline = await getGuideSubject(t.db, id, whole, merged.ref);
		expect(timeline.ok && titles(timeline.subject?.notes ?? []).sort()).toEqual(
			["On Brawne", "On Lamia"],
		);
		const all = await listGuideNotes(t.db, id, whole);
		expect(all.ok && titles(all.notes).sort()).toEqual([
			"On Brawne",
			"On Lamia",
			"Unattached",
		]);
		expect(
			all.ok && all.notes.find((n) => n.title === "On Brawne")?.subject,
		).toEqual({ key: "brawne", ref: merged.ref, name: "Brawne Lamia" });
	});

	it("lists a unit's notes with that unit in Chapters", async () => {
		const id = await book();
		const second = await startOf(id, 1);
		await created(
			id,
			note("About two", {
				anchor: { kind: "unit", endPosition: u(1).endPosition },
				attachment: { kind: "unit", unitLocator: second },
			}),
		);
		await created(
			id,
			note("Late about two", {
				anchor: { kind: "unit", endPosition: u(2).endPosition },
				attachment: { kind: "unit", unitLocator: second },
			}),
		);
		await created(
			id,
			note("Loose", {
				anchor: { kind: "unit", endPosition: u(0).endPosition },
			}),
		);
		expect(
			titles(
				await listNotes(t.db, id, null, { kind: "unit", locators: [second] }),
			),
		).toEqual(["About two", "Late about two"]);
		expect(
			titles(await listNotes(t.db, id, u(1).endPosition, { kind: "unit" })),
		).toEqual(["About two"]);

		const chapters = await getGuideChapters(t.db, id, through(1));
		if (!chapters.ok) throw new Error(chapters.reason);
		expect(chapters.chapters.map((c) => titles(c.notes))).toEqual([
			[],
			["About two"],
		]);
		expect(chapters.chapters[1]?.notes[0]?.unit).toEqual({
			locator: second,
			label: u(1).label,
		});
		const later = await getGuideChapters(t.db, id, whole);
		expect(later.ok && later.chapters.map((c) => titles(c.notes))).toEqual([
			[],
			["About two", "Late about two"],
			[],
		]);
	});
});

describe("edition deletion", () => {
	it("counts the reader's notes, corrections and confirmed subjects", async () => {
		const id = await book();
		expect(await countReaderContent(t.db, id)).toEqual({
			notes: 0,
			corrections: 0,
			subjects: 0,
		});
		await saveUnitResult(t.db, id, result(0, ["Anna", "Anna Karenina"]));
		await created(id, note("One", { anchor: { kind: "end" } }));
		await created(id, note("Two", { anchor: { kind: "end" } }));
		const merged = await mergeSubjects(t.db, id, whole, {
			targetRef: "k:anna karenina",
			sourceRef: "k:anna",
			reveal: { kind: "unit", endPosition: u(0).endPosition },
		});
		expect(merged.ok).toBe(true);
		const corrected = await saveCorrection(t.db, id, {
			target: "summary",
			unitLocator: await startOf(id, 0),
			action: "suppress",
		});
		expect(corrected.ok).toBe(true);
		expect(await countReaderContent(t.db, id)).toEqual({
			notes: 2,
			corrections: 1,
			subjects: 1,
		});
		// Another book's content is not counted.
		expect(await countReaderContent(t.db, await book())).toEqual({
			notes: 0,
			corrections: 0,
			subjects: 0,
		});
	});

	it("deletes the edition's notes with it", async () => {
		const id = await book();
		await created(id, note("Doomed", { anchor: { kind: "end" } }));
		await deleteEdition(t.db, dataDir, id, silentLog);
		expect(
			await t.db
				.select()
				.from(readerNotes)
				.where(eq(readerNotes.editionId, id)),
		).toEqual([]);
	});
});
