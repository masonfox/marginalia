// Reader notes (design D2, D3): the reader's own guide pages, each visible
// only from its "as of" anchor on. Notes are reader-authored and never
// evidence; this file owns their edits, their default anchor and their
// bounded reads.
import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	inArray,
	isNotNull,
	lte,
	or,
	sql,
} from "drizzle-orm";
import type { ReaderContentCounts } from "#/lib/reader-content";
import { unitObservations } from "#/modules/analysis";
import { passages, type ReadingUnit } from "#/modules/catalog";
import { editions } from "#/modules/library";
import { createRetrieval } from "#/modules/retrieval";
import type { Database, Executor } from "#/server/db";
import { getReadingPosition } from "./position";
import { getUnitAnchors, type UnitAnchors } from "./queries";
import {
	guideCorrections,
	guideSubjectAliases,
	guideSubjects,
	type NoteAnchorKind,
	readerNotes,
} from "./schema";
import { parseRef, type SubjectResolution } from "./subjects";

/** The longest note title, in UTF-16 units. */
export const MAX_NOTE_TITLE = 200;
/** The longest note body, in UTF-16 units. */
export const MAX_NOTE_BODY = 20_000;

/**
 * Where a note is written "as of": a reading unit by its end position
 * (stored as its last passage), one passage by its locator, or the end of
 * the book.
 */
export type NoteAnchorChoice =
	| { kind: "unit"; endPosition: number }
	| { kind: "passage"; locator: string }
	| { kind: "end" };

/** What a note may be attached to: nothing, a subject by its ref, or a unit by its anchor. */
export type NoteAttachment =
	| { kind: "none" }
	| { kind: "subject"; ref: string }
	| { kind: "unit"; unitLocator: string };

/** A stored "as of" anchor. Locator and position are null exactly for the end of the book. */
export interface NoteAsOf {
	kind: NoteAnchorKind;
	locator: string | null;
	position: number | null;
	/** The unit's label, or that of the unit holding the passage; null for the end of the book. */
	label: string | null;
}

/** A stored note, as the bounded reads return it. */
export interface ReaderNote {
	id: number;
	title: string;
	body: string;
	asOf: NoteAsOf;
	/** The attached subject's name key, or null. */
	subjectKey: string | null;
	/** The attached unit's anchor, or null. */
	unitLocator: string | null;
	sourceConversationId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** What the reader writes. Without `anchor`, the note is anchored at the reading position. */
export interface NoteInput {
	title: string;
	body: string;
	anchor?: NoteAnchorChoice;
	attachment?: NoteAttachment;
	/** The conversation the note is saved from; kept on later edits when omitted. */
	sourceConversationId?: string | null;
}

/**
 * A note edit, or why it was refused, with a message for the reader.
 * `too_long`: the title or body is over its limit, which is stated.
 * `empty_title`: the title is blank. `anchor_required`: no anchor was given
 * and the reading position is unset. `stale_anchor`: the anchor unit or
 * passage is not one of the book's current ones. `stale_attachment`: the
 * subject or unit to attach to is not one of the book's. `not_found`: the
 * edition is missing or not ready, or the note does not exist.
 */
export type NoteResult =
	| { ok: true; note: ReaderNote }
	| {
			ok: false;
			reason: "too_long";
			field: "title" | "body";
			limit: number;
			message: string;
	  }
	| {
			ok: false;
			reason:
				| "not_found"
				| "empty_title"
				| "anchor_required"
				| "stale_anchor"
				| "stale_attachment";
			message: string;
	  };

const MESSAGES = {
	not_found: "This note or book no longer exists.",
	empty_title: "A note needs a title.",
	anchor_required:
		"Choose how far into the book this note is written as of: no reading position is set.",
	stale_anchor:
		"This book's chapters changed since the list was loaded. Please choose the note's position again.",
	stale_attachment:
		"What this note is attached to is no longer part of the book. Please choose again.",
} as const;

type Refusal = Extract<NoteResult, { ok: false }>;
const refuse = (reason: keyof typeof MESSAGES): Refusal => ({
	ok: false,
	reason,
	message: MESSAGES[reason],
});

const tooLong = (field: "title" | "body", limit: number): Refusal => ({
	ok: false,
	reason: "too_long",
	field,
	limit,
	message: `A note's ${field} can be at most ${limit.toLocaleString("en-US")} characters.`,
});

/** Checks a note's title and body against the limits; null when they pass. */
function checkText(input: NoteInput): Refusal | null {
	const title = input.title.trim();
	if (title.length === 0) return refuse("empty_title");
	if (title.length > MAX_NOTE_TITLE) return tooLong("title", MAX_NOTE_TITLE);
	if (input.body.length > MAX_NOTE_BODY) return tooLong("body", MAX_NOTE_BODY);
	return null;
}

const noteColumns = {
	id: readerNotes.id,
	title: readerNotes.title,
	body: readerNotes.body,
	asOfKind: readerNotes.asOfKind,
	asOfLocator: readerNotes.asOfLocator,
	asOfPosition: readerNotes.asOfPosition,
	asOfLabel: readerNotes.asOfLabel,
	subjectKey: readerNotes.subjectKey,
	unitLocator: readerNotes.unitLocator,
	sourceConversationId: readerNotes.sourceConversationId,
	createdAt: readerNotes.createdAt,
	updatedAt: readerNotes.updatedAt,
};

type NoteRow = Pick<typeof readerNotes.$inferSelect, keyof typeof noteColumns>;

const toNote = (row: NoteRow): ReaderNote => ({
	id: row.id,
	title: row.title,
	body: row.body,
	asOf: {
		kind: row.asOfKind,
		locator: row.asOfLocator,
		position: row.asOfPosition,
		label: row.asOfLabel,
	},
	subjectKey: row.subjectKey,
	unitLocator: row.unitLocator,
	sourceConversationId: row.sourceConversationId,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

/** The current unit holding a reading-order position, or null when none does. */
const unitHolding = (units: ReadingUnit[], position: number) =>
	units.find((u) => u.startPosition <= position && position <= u.endPosition) ??
	null;

/**
 * The anchor a new note defaults to (reader-notes "As of" anchor): the
 * reading position's unit, or the end of the book when the position is
 * finished. A position that no longer ends a current unit falls back to the
 * last unit ending before it, so the default never reaches past the
 * position. Null when the position is unset or precedes every unit: the
 * reader must choose.
 */
export async function defaultNoteAnchor(
	db: Executor,
	editionId: string,
	anchors?: UnitAnchors,
): Promise<{ choice: NoteAnchorChoice; label: string | null } | null> {
	const position = await getReadingPosition(db, editionId);
	if (position === null) return null;
	if (position.kind === "finished")
		return { choice: { kind: "end" }, label: null };
	const { units } = anchors ?? (await getUnitAnchors(db, editionId));
	const unit = units
		.filter((u) => u.endPosition <= position.maxPosition)
		.at(-1);
	if (!unit) return null;
	return {
		choice: { kind: "unit", endPosition: unit.endPosition },
		label: unit.label,
	};
}

/** The stored anchor of a choice among the book's current units and passages, or null when it is not one. */
async function resolveAnchor(
	tx: Executor,
	editionId: string,
	anchors: UnitAnchors,
	choice: NoteAnchorChoice,
): Promise<NoteAsOf | null> {
	if (choice.kind === "end")
		return { kind: "end", locator: null, position: null, label: null };
	if (choice.kind === "unit") {
		const unit = anchors.units.find(
			(u) => u.endPosition === choice.endPosition,
		);
		if (!unit) return null;
		const [last] = await tx
			.select({ locator: passages.locator, position: passages.revealPosition })
			.from(passages)
			.where(
				and(
					eq(passages.editionId, editionId),
					eq(passages.position, unit.endPosition),
				),
			);
		if (!last) return null;
		return { kind: "unit", ...last, label: unit.label };
	}
	// Older locators are forwarded to the passage that now holds their text.
	const resolved = await createRetrieval(tx).resolve(choice.locator);
	if (resolved.status !== "found" || resolved.edition.id !== editionId)
		return null;
	const { position, revealPosition } = resolved.passage;
	return {
		kind: "passage",
		locator: resolved.currentLocator,
		position: revealPosition,
		label:
			unitHolding(anchors.units, position ?? revealPosition)?.label ?? null,
	};
}

/**
 * The stored attachment of a choice: a subject by its name key (a confirmed
 * subject by its primary name, which every bound groups with it), or a unit
 * by its anchor. Null when the subject or unit is not one of the book's.
 */
async function resolveAttachment(
	tx: Executor,
	editionId: string,
	anchors: UnitAnchors,
	attachment: NoteAttachment,
	current: { subjectKey: string | null } | null,
): Promise<{ subjectKey: string | null; unitLocator: string | null } | null> {
	if (attachment.kind === "none")
		return { subjectKey: null, unitLocator: null };
	if (attachment.kind === "unit")
		return anchors.unitAt(attachment.unitLocator)
			? { subjectKey: null, unitLocator: attachment.unitLocator }
			: null;
	const ref = parseRef(attachment.ref);
	if (!ref) return null;
	if (ref.kind === "subject") {
		const [primary] = await tx
			.select({ nameKey: guideSubjectAliases.nameKey })
			.from(guideSubjectAliases)
			.where(
				and(
					eq(guideSubjectAliases.editionId, editionId),
					eq(guideSubjectAliases.subjectId, ref.id),
					eq(guideSubjectAliases.isPrimary, true),
				),
			);
		return primary ? { subjectKey: primary.nameKey, unitLocator: null } : null;
	}
	// A name the note is already attached to stays valid while it is not observed.
	if (current?.subjectKey === ref.key)
		return { subjectKey: ref.key, unitLocator: null };
	const [observed] = await tx
		.select({ nameKey: unitObservations.nameKey })
		.from(unitObservations)
		.where(
			and(
				eq(unitObservations.editionId, editionId),
				eq(unitObservations.nameKey, ref.key),
			),
		)
		.limit(1);
	return observed ? { subjectKey: ref.key, unitLocator: null } : null;
}

/** Runs a note edit with the book's structure locked against a concurrent reparse. */
async function editNotes(
	db: Database,
	editionId: string,
	edit: (tx: Executor, anchors: UnitAnchors) => Promise<NoteResult>,
): Promise<NoteResult> {
	return db.transaction(async (tx) => {
		const [edition] = await tx
			.select({ status: editions.status })
			.from(editions)
			.where(eq(editions.id, editionId))
			.for("share");
		if (!edition || edition.status !== "ready") return refuse("not_found");
		return edit(tx, await getUnitAnchors(tx, editionId));
	});
}

/** The stored columns of a note's anchor. */
const anchorColumns = (asOf: NoteAsOf) => ({
	asOfKind: asOf.kind,
	asOfLocator: asOf.locator,
	asOfPosition: asOf.position,
	asOfLabel: asOf.label,
});

/**
 * Creates a note. Its anchor defaults to the reading position (the end of
 * the book once finished); with no position set, the reader must give one.
 */
export async function createNote(
	db: Database,
	editionId: string,
	input: NoteInput,
): Promise<NoteResult> {
	const invalid = checkText(input);
	if (invalid) return invalid;
	return editNotes(db, editionId, async (tx, anchors) => {
		const choice =
			input.anchor ?? (await defaultNoteAnchor(tx, editionId, anchors))?.choice;
		if (!choice) return refuse("anchor_required");
		const asOf = await resolveAnchor(tx, editionId, anchors, choice);
		if (!asOf) return refuse("stale_anchor");
		const attached = await resolveAttachment(
			tx,
			editionId,
			anchors,
			input.attachment ?? { kind: "none" },
			null,
		);
		if (!attached) return refuse("stale_attachment");
		const [row] = await tx
			.insert(readerNotes)
			.values({
				editionId,
				title: input.title.trim(),
				body: input.body,
				...anchorColumns(asOf),
				...attached,
				sourceConversationId: input.sourceConversationId ?? null,
			})
			.returning(noteColumns);
		return { ok: true, note: toNote(row as NoteRow) };
	});
}

/**
 * Edits a note's title, body, anchor, or attachment. Omitting the anchor or
 * the attachment keeps it as stored.
 */
export async function updateNote(
	db: Database,
	editionId: string,
	id: number,
	input: NoteInput,
): Promise<NoteResult> {
	const invalid = checkText(input);
	if (invalid) return invalid;
	return editNotes(db, editionId, async (tx, anchors) => {
		const [current] = await tx
			.select({ subjectKey: readerNotes.subjectKey })
			.from(readerNotes)
			.where(and(eq(readerNotes.editionId, editionId), eq(readerNotes.id, id)))
			.for("update");
		if (!current) return refuse("not_found");
		let asOf: NoteAsOf | null = null;
		if (input.anchor) {
			asOf = await resolveAnchor(tx, editionId, anchors, input.anchor);
			if (!asOf) return refuse("stale_anchor");
		}
		let attached: Awaited<ReturnType<typeof resolveAttachment>> = null;
		if (input.attachment) {
			attached = await resolveAttachment(
				tx,
				editionId,
				anchors,
				input.attachment,
				current,
			);
			if (!attached) return refuse("stale_attachment");
		}
		const [row] = await tx
			.update(readerNotes)
			.set({
				title: input.title.trim(),
				body: input.body,
				...(asOf ? anchorColumns(asOf) : {}),
				...(attached ?? {}),
				...(input.sourceConversationId !== undefined
					? { sourceConversationId: input.sourceConversationId }
					: {}),
				updatedAt: new Date(),
			})
			.where(eq(readerNotes.id, id))
			.returning(noteColumns);
		return { ok: true, note: toNote(row as NoteRow) };
	});
}

/** Deletes a note. False when there was none. */
export async function deleteNote(
	db: Executor,
	editionId: string,
	id: number,
): Promise<boolean> {
	const removed = await db
		.delete(readerNotes)
		.where(and(eq(readerNotes.editionId, editionId), eq(readerNotes.id, id)))
		.returning({ id: readerNotes.id });
	return removed.length > 0;
}

/**
 * Which notes a bounded read returns: all of them, those attached to any of
 * a subject's name keys, or those attached to units (optionally only some).
 */
export type NoteFilter =
	| { kind: "all" }
	| { kind: "subject"; keys: string[] }
	| { kind: "unit"; locators?: string[] };

/**
 * Notes visible at a bound (design D2): those whose anchor is at or before
 * it. The bound is the Guide's, a conversation's for this book, or the
 * passage on screen; null is the whole book, the only bound at which notes
 * anchored at the end of the book show. With `match`, only notes whose title
 * or body contains it, ignoring case. In reading order of their anchors,
 * the end of the book last, most recently edited first among equals.
 */
export async function listNotes(
	db: Executor,
	editionId: string,
	bound: number | null,
	filter: NoteFilter = { kind: "all" },
	{ match }: { match?: string } = {},
): Promise<ReaderNote[]> {
	if (filter.kind === "subject" && filter.keys.length === 0) return [];
	if (filter.kind === "unit" && filter.locators?.length === 0) return [];
	// LIKE wildcards in the reader's words match themselves.
	const pattern =
		match === undefined ? undefined : `%${match.replace(/[\\%_]/g, "\\$&")}%`;
	const rows = await db
		.select(noteColumns)
		.from(readerNotes)
		.where(
			and(
				eq(readerNotes.editionId, editionId),
				bound === null ? undefined : lte(readerNotes.asOfPosition, bound),
				pattern === undefined
					? undefined
					: or(
							ilike(readerNotes.title, pattern),
							ilike(readerNotes.body, pattern),
						),
				filter.kind === "subject"
					? inArray(readerNotes.subjectKey, filter.keys)
					: filter.kind === "unit"
						? filter.locators
							? inArray(readerNotes.unitLocator, filter.locators)
							: isNotNull(readerNotes.unitLocator)
						: undefined,
			),
		)
		.orderBy(
			sql`${readerNotes.asOfPosition} asc nulls last`,
			desc(readerNotes.updatedAt),
			asc(readerNotes.id),
		);
	return rows.map(toNote);
}

/** One note, when it is visible at the bound; null otherwise. */
export async function getNote(
	db: Executor,
	editionId: string,
	id: number,
	bound: number | null,
): Promise<ReaderNote | null> {
	const [row] = await db
		.select(noteColumns)
		.from(readerNotes)
		.where(
			and(
				eq(readerNotes.editionId, editionId),
				eq(readerNotes.id, id),
				bound === null ? undefined : lte(readerNotes.asOfPosition, bound),
			),
		);
	return row ? toNote(row) : null;
}

/**
 * Counts the reader's notes, corrections, and confirmed subjects of an
 * edition: what deleting the book deletes with it.
 */
export async function countReaderContent(
	db: Executor,
	editionId: string,
): Promise<ReaderContentCounts> {
	const tally = async (
		table: typeof readerNotes | typeof guideCorrections | typeof guideSubjects,
	) => {
		const [row] = await db
			.select({ n: count() })
			.from(table)
			.where(eq(table.editionId, editionId));
		return row?.n ?? 0;
	};
	const [notes, corrections, subjects] = await Promise.all([
		tally(readerNotes),
		tally(guideCorrections),
		tally(guideSubjects),
	]);
	return { notes, corrections, subjects };
}

/**
 * Notes attached to a subject and visible at a bound: those attached to any
 * name that resolves to the subject there (resolveSubjects), so an alias's
 * notes join its subject only once the alias is revealed.
 */
export async function listSubjectNotes(
	db: Executor,
	editionId: string,
	ref: string,
	bound: number | null,
	resolution: SubjectResolution,
): Promise<ReaderNote[]> {
	const keys = resolution.keysOf(ref);
	if (!keys) return [];
	return listNotes(db, editionId, bound, { kind: "subject", keys });
}
