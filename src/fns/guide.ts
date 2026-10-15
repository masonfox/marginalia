import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { OBSERVATION_KINDS } from "#/modules/analysis";
import {
	clearReadingPosition,
	countReaderContent,
	createNote,
	deleteNote,
	dismissProposal,
	excludeGlossName,
	getCorrectionReview,
	getGlossCard,
	getGuideChapters,
	getGuideNote,
	getGuideOverview,
	getGuideProvenance,
	getGuideSubject,
	getNoteDefaults,
	getReadingPosition,
	getSectionGlosses,
	includeGlossName,
	keepCorrection,
	listGuideNotes,
	listGuideProposals,
	listGuideSubjects,
	MAX_CITATION_QUOTE,
	MAX_CORRECTION_TEXT,
	MAX_NOTE_BODY,
	MAX_NOTE_TITLE,
	mergeSubjects,
	removeCorrection,
	renameSubject,
	saveCorrection,
	setReadingPosition,
	setSubjectKind,
	splitSubject,
	updateNote,
} from "#/modules/guide";
import { appContext } from "#/server/context";

// Only server functions are exported here: anything else would pull server code into the client bundle.

const choiceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("whole") }),
	z.object({ kind: z.literal("unit"), endPosition: z.number().int() }),
]);

/** The book's reading position, or null when it is unset. */
export const getReadingPositionFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(({ data }) => getReadingPosition(appContext().db, data.editionId));

/**
 * Sets the book's reading position. A move to an earlier unit is refused
 * with `move_back` unless `moveBack` confirms it, and a unit that is no
 * longer one of the book's units with `stale_scope`.
 */
export const setReadingPositionFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			editionId: z.uuid(),
			choice: choiceSchema,
			moveBack: z.boolean().optional(),
		}),
	)
	.handler(({ data }) =>
		setReadingPosition(appContext().db, data.editionId, data.choice, {
			moveBack: data.moveBack,
		}),
	);

/** Clears the book's reading position back to unset. */
export const clearReadingPositionFn = createServerFn({ method: "POST" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(async ({ data }) => ({
		cleared: await clearReadingPosition(appContext().db, data.editionId),
	}));

/** The book, its reading position and whether it has guide data, or null when it does not exist. */
export const getGuideFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(({ data }) => getGuideOverview(appContext().db, data.editionId));

// Every Guide read names its bound, validated against the book's current
// units: `stale_bound` when it is not one of them.
const boundedSchema = z.object({ editionId: z.uuid(), bound: choiceSchema });

/** The reading units within the bound, with their summaries. */
export const getGuideChaptersFn = createServerFn({ method: "GET" })
	.validator(boundedSchema)
	.handler(({ data }) =>
		getGuideChapters(appContext().db, data.editionId, data.bound),
	);

/** The subjects observed within the bound; with `includeHidden`, those the reader suppressed too. */
export const listGuideSubjectsFn = createServerFn({ method: "GET" })
	.validator(boundedSchema.extend({ includeHidden: z.boolean().optional() }))
	.handler(({ data }) =>
		listGuideSubjects(appContext().db, data.editionId, data.bound, {
			includeHidden: data.includeHidden,
		}),
	);

/** One subject's timeline within the bound. */
export const getGuideSubjectFn = createServerFn({ method: "GET" })
	.validator(boundedSchema.extend({ subjectRef: z.string().min(1).max(500) }))
	.handler(({ data }) =>
		getGuideSubject(
			appContext().db,
			data.editionId,
			data.bound,
			data.subjectRef,
		),
	);

/** The model, prompt version and preprocessing state behind the Guide's data. */
export const getGuideProvenanceFn = createServerFn({ method: "GET" })
	.validator(boundedSchema)
	.handler(({ data }) =>
		getGuideProvenance(appContext().db, data.editionId, data.bound),
	);

/** Merges proposed among the names observed within the bound. */
export const listGuideProposalsFn = createServerFn({ method: "GET" })
	.validator(boundedSchema)
	.handler(({ data }) =>
		listGuideProposals(appContext().db, data.editionId, data.bound),
	);

// Subject edits name the Guide's bound too: the reader edits the subjects
// as the Guide shows them, and each result carries the subject's new ref.
const refSchema = z.string().min(1).max(500);
const nameKeySchema = z.string().min(1).max(500);

/**
 * Merges one subject into another, revealed from the end of a unit or from
 * a passage: never earlier than a link already in either subject says.
 */
export const mergeSubjectsFn = createServerFn({ method: "POST" })
	.validator(
		boundedSchema.extend({
			targetRef: refSchema,
			sourceRef: refSchema,
			reveal: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("unit"), endPosition: z.number().int() }),
				z.object({
					kind: z.literal("passage"),
					locator: z.string().min(1).max(200),
				}),
			]),
		}),
	)
	.handler(({ data }) =>
		mergeSubjects(appContext().db, data.editionId, data.bound, data),
	);

/** Splits a name out of a subject, so it is its own subject again. */
export const splitSubjectFn = createServerFn({ method: "POST" })
	.validator(boundedSchema.extend({ ref: refSchema, nameKey: nameKeySchema }))
	.handler(({ data }) =>
		splitSubject(appContext().db, data.editionId, data.bound, data),
	);

/** Chooses which of its names a subject is shown under. */
export const renameSubjectFn = createServerFn({ method: "POST" })
	.validator(
		boundedSchema.extend({ ref: refSchema, displayKey: nameKeySchema }),
	)
	.handler(({ data }) =>
		renameSubject(appContext().db, data.editionId, data.bound, data),
	);

/** Sets a subject's kind, or clears it back to its observations' kind. */
export const setSubjectKindFn = createServerFn({ method: "POST" })
	.validator(
		boundedSchema.extend({
			ref: refSchema,
			kind: z.enum(OBSERVATION_KINDS).nullable(),
		}),
	)
	.handler(({ data }) =>
		setSubjectKind(appContext().db, data.editionId, data.bound, data),
	);

/** Dismisses a proposed merge, so that pair of names is not proposed again. */
export const dismissProposalFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			editionId: z.uuid(),
			keys: z.tuple([nameKeySchema, nameKeySchema]),
		}),
	)
	.handler(async ({ data }) => ({
		dismissed: await dismissProposal(
			appContext().db,
			data.editionId,
			data.keys,
		),
	}));

// Corrections name the unit by its anchor (the locator of its first passage)
// and, for an observation, the observed name key: never a machine row id.
const correctionSchema = z
	.object({
		editionId: z.uuid(),
		unitLocator: z.string().min(1).max(200),
	})
	.and(
		z.discriminatedUnion("target", [
			z.object({ target: z.literal("summary") }),
			z.object({ target: z.literal("observation"), nameKey: nameKeySchema }),
		]),
	)
	.and(
		z.discriminatedUnion("action", [
			z.object({
				action: z.literal("replace"),
				text: z.string().min(1).max(MAX_CORRECTION_TEXT),
				citation: z
					.object({
						locator: z.string().min(1).max(200),
						quote: z.string().min(1).max(MAX_CITATION_QUOTE),
					})
					.nullish(),
			}),
			z.object({ action: z.literal("suppress") }),
		]),
	);

/**
 * Replaces a unit's summary, or its observations of a name, with the
 * reader's text and at most one citation from that unit, or suppresses it.
 * A citation from another unit is refused with `citation_outside_unit`.
 */
export const saveCorrectionFn = createServerFn({ method: "POST" })
	.validator(correctionSchema)
	.handler(({ data: { editionId, ...input } }) =>
		saveCorrection(appContext().db, editionId, input),
	);

const correctionIdSchema = z.object({
	editionId: z.uuid(),
	id: z.number().int().positive(),
});

/** Keeps a correction whose row was regenerated since, clearing the flag. */
export const keepCorrectionFn = createServerFn({ method: "POST" })
	.validator(correctionIdSchema)
	.handler(({ data }) =>
		keepCorrection(appContext().db, data.editionId, data.id),
	);

/** Removes a correction, restoring the generated row. */
export const removeCorrectionFn = createServerFn({ method: "POST" })
	.validator(correctionIdSchema)
	.handler(async ({ data }) => ({
		removed: await removeCorrection(appContext().db, data.editionId, data.id),
	}));

/** The reader's corrections to review within the bound: regenerated since, or detached. */
export const getCorrectionReviewFn = createServerFn({ method: "GET" })
	.validator(boundedSchema)
	.handler(({ data }) =>
		getCorrectionReview(appContext().db, data.editionId, data.bound),
	);

// Notes name their anchor (a unit by its end, a passage, or the end of the
// book) and their attachment (a subject by its ref, or a unit by its anchor).
const noteAnchorSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unit"), endPosition: z.number().int() }),
	z.object({ kind: z.literal("passage"), locator: z.string().min(1).max(200) }),
	z.object({ kind: z.literal("end") }),
]);

const noteInputSchema = z.object({
	editionId: z.uuid(),
	// The limits are checked by the module, whose refusal states them; these
	// only cap what is accepted at all.
	title: z.string().max(MAX_NOTE_TITLE * 5),
	body: z.string().max(MAX_NOTE_BODY * 5),
	anchor: noteAnchorSchema.optional(),
	attachment: z
		.discriminatedUnion("kind", [
			z.object({ kind: z.literal("none") }),
			z.object({ kind: z.literal("subject"), ref: refSchema }),
			z.object({
				kind: z.literal("unit"),
				unitLocator: z.string().min(1).max(200),
			}),
		])
		.optional(),
	sourceConversationId: z.uuid().nullish(),
});

/** The notes visible within the bound. */
export const listGuideNotesFn = createServerFn({ method: "GET" })
	.validator(boundedSchema)
	.handler(({ data }) =>
		listGuideNotes(appContext().db, data.editionId, data.bound),
	);

/** One note, or null when it is not visible within the bound. */
export const getGuideNoteFn = createServerFn({ method: "GET" })
	.validator(boundedSchema.extend({ id: z.number().int().positive() }))
	.handler(({ data }) =>
		getGuideNote(appContext().db, data.editionId, data.bound, data.id),
	);

/** The anchor a new note defaults to: null when the reader must choose. */
export const getNoteDefaultsFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(({ data }) => getNoteDefaults(appContext().db, data.editionId));

/**
 * Creates a note, anchored at the reading position unless an anchor is
 * given. Refused with `too_long` (and the limit) or `anchor_required`.
 */
export const createNoteFn = createServerFn({ method: "POST" })
	.validator(noteInputSchema)
	.handler(({ data: { editionId, ...input } }) =>
		createNote(appContext().db, editionId, input),
	);

/** Edits a note; an omitted anchor or attachment is kept. */
export const updateNoteFn = createServerFn({ method: "POST" })
	.validator(noteInputSchema.extend({ id: z.number().int().positive() }))
	.handler(({ data: { editionId, id, ...input } }) =>
		updateNote(appContext().db, editionId, id, input),
	);

/** Deletes a note. */
export const deleteNoteFn = createServerFn({ method: "POST" })
	.validator(z.object({ editionId: z.uuid(), id: z.number().int().positive() }))
	.handler(async ({ data }) => ({
		deleted: await deleteNote(appContext().db, data.editionId, data.id),
	}));

// Margin glosses are bounded by the passage on screen: each passage at its
// own reveal position, never the reading position.

/** The glosses of the section the passage reader shows for `locator`. */
export const getSectionGlossesFn = createServerFn({ method: "GET" })
	.validator(z.object({ locator: z.string().min(1).max(200) }))
	.handler(({ data }) => getSectionGlosses(appContext().db, data.locator));

/** A gloss's card: the subject as of the passage it was opened on, or null. */
export const getGlossCardFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			editionId: z.uuid(),
			subjectRef: refSchema,
			locator: z.string().min(1).max(200),
		}),
	)
	.handler(({ data }) =>
		getGlossCard(
			appContext().db,
			data.editionId,
			data.subjectRef,
			data.locator,
		),
	);

const glossNameSchema = z.object({
	editionId: z.uuid(),
	nameKey: nameKeySchema,
});

/** Stops a name from being glossed anywhere in the book. */
export const excludeGlossNameFn = createServerFn({ method: "POST" })
	.validator(glossNameSchema)
	.handler(async ({ data }) => ({
		excluded: await excludeGlossName(
			appContext().db,
			data.editionId,
			data.nameKey,
		),
	}));

/** Glosses a name again. */
export const includeGlossNameFn = createServerFn({ method: "POST" })
	.validator(glossNameSchema)
	.handler(async ({ data }) => ({
		included: await includeGlossName(
			appContext().db,
			data.editionId,
			data.nameKey,
		),
	}));

/** How many notes, corrections, and confirmed subjects deleting the book would delete. */
export const countReaderContentFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(({ data }) => countReaderContent(appContext().db, data.editionId));
