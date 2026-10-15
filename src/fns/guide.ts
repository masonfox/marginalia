import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	clearReadingPosition,
	getReadingPosition,
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
