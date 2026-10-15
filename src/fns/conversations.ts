import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getReadingUnits } from "#/modules/catalog";
import {
	checkPassageRef,
	createConversationForEdition,
	deleteConversation,
	getConversation,
	getConversationWithUsage,
	listConversationsForEdition,
	type PassageCheck,
	passageRefSchema,
	renameConversation,
	widenConversationScope,
} from "#/modules/conversation";
import { priceTable } from "#/modules/usage";
import { appContext } from "#/server/context";

// Only server functions are exported here: anything else would pull server code into the client bundle.

/** Whether AI is configured, and which provider and model. Never includes the API key. */
export const getAiStatusFn = createServerFn({ method: "GET" }).handler(
	() => appContext().ai.status,
);

export const listConversationsFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(({ data }) =>
		listConversationsForEdition(appContext().db, data.editionId),
	);

const scopeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("whole") }),
	z.object({ kind: z.literal("unit"), endPosition: z.number().int() }),
]);

/** The book's reading units, for choosing a conversation's scope. */
export const getReadingUnitsFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(({ data }) => getReadingUnits(appContext().db, data.editionId));

/**
 * Starts a single-book conversation with the reader's chosen scope. Returns
 * null when the book is missing or not ready, and `stale_scope` when the
 * chosen unit no longer exists (reload the units and choose again).
 */
export const createConversationFn = createServerFn({ method: "POST" })
	.validator(z.object({ editionId: z.uuid(), scope: scopeSchema }))
	.handler(({ data }) =>
		createConversationForEdition(appContext().db, data.editionId, data.scope),
	);

/** Widens one book's scope in a conversation; never narrows it. */
export const widenScopeFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			conversationId: z.uuid(),
			editionId: z.uuid(),
			scope: scopeSchema,
		}),
	)
	.handler(({ data }) => widenConversationScope(appContext().db, data));

/**
 * Checks a passage reference against a conversation before it is attached:
 * `ok` with the server's snapshot, `out_of_scope` with the containing unit,
 * or `invalid`. Sending re-checks, so this result is only for the composer.
 */
export const checkPassageRefFn = createServerFn({ method: "GET" })
	.validator(z.object({ conversationId: z.uuid(), ref: passageRefSchema }))
	.handler(
		async ({ data }): Promise<PassageCheck | { status: "no_conversation" }> => {
			const { db } = appContext();
			const conversation = await getConversation(db, data.conversationId);
			if (!conversation) return { status: "no_conversation" };
			return checkPassageRef(db, conversation, data.ref);
		},
	);

/** A conversation with per-reply usage and the running total. Costs are estimates. */
export const getConversationFn = createServerFn({ method: "GET" })
	.validator(z.object({ conversationId: z.uuid() }))
	.handler(({ data }) => {
		const { db, config } = appContext();
		return getConversationWithUsage(
			db,
			data.conversationId,
			priceTable(config.ai?.prices),
		);
	});

export const renameConversationFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			conversationId: z.uuid(),
			title: z.string().trim().min(1).max(200),
		}),
	)
	.handler(async ({ data }) => ({
		renamed: await renameConversation(
			appContext().db,
			data.conversationId,
			data.title,
		),
	}));

export const deleteConversationFn = createServerFn({ method: "POST" })
	.validator(z.object({ conversationId: z.uuid() }))
	.handler(async ({ data }) => ({
		deleted: await deleteConversation(appContext().db, data.conversationId),
	}));
