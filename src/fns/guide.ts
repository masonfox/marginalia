import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	clearReadingPosition,
	getGuideChapters,
	getGuideOverview,
	getGuideProvenance,
	getGuideSubject,
	getReadingPosition,
	listGuideSubjects,
	setReadingPosition,
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

/** The subjects observed within the bound. */
export const listGuideSubjectsFn = createServerFn({ method: "GET" })
	.validator(boundedSchema)
	.handler(({ data }) =>
		listGuideSubjects(appContext().db, data.editionId, data.bound),
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
