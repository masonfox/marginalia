import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { selectionSchema } from "#/modules/ai";
import { getReadingUnits } from "#/modules/catalog";
import {
	checkPassageRef,
	createConversationForEdition,
	deleteConversation,
	getConversation,
	getConversationWithUsage,
	getGuideStep,
	getTrailObservations,
	listConversationsForEdition,
	type PassageCheck,
	passageRefSchema,
	renameConversation,
	setConversationModel,
	widenConversationScope,
} from "#/modules/conversation";
import { getAiStatus } from "#/modules/settings";
import { priceTable } from "#/modules/usage";
import { appContext } from "#/server/context";

// Only server functions are exported here: anything else would pull server code into the client bundle.

/**
 * Whether AI is enabled, the available providers, and both defaults with
 * their source and availability. Never includes API keys or base URLs.
 */
export const getAiStatusFn = createServerFn({ method: "GET" }).handler(() => {
	const { db, ai } = appContext();
	return getAiStatus(db, ai);
});

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
 * Starts a single-book conversation with the reader's chosen scope and,
 * optionally, its own model. Returns null when the book is missing or not
 * ready, `stale_scope` when the chosen unit no longer exists (reload the
 * units and choose again), and `model_unavailable` when the model's provider
 * has no credentials.
 */
export const createConversationFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			editionId: z.uuid(),
			scope: scopeSchema,
			selection: selectionSchema.optional(),
		}),
	)
	.handler(({ data }) => {
		const { db, ai } = appContext();
		if (data.selection && !ai.available().includes(data.selection.provider))
			return { error: "model_unavailable" as const };
		return createConversationForEdition(
			db,
			data.editionId,
			data.scope,
			data.selection,
		);
	});

/**
 * Sets a conversation's own model, or clears it with null so it follows the
 * chat default. Refused (`busy`) while a reply is being generated, and
 * `unavailable` when the provider has no credentials.
 */
export const setConversationModelFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			conversationId: z.uuid(),
			selection: selectionSchema.nullable(),
		}),
	)
	.handler(({ data }) =>
		setConversationModel(appContext(), data.conversationId, data.selection),
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

/**
 * A reply's guide step read again: the summaries now within its recorded
 * scope (never past the conversation's), corrections applied, and whether
 * the guide changed since the reply. `gone` when the book was deleted.
 */
export const getGuideStepFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			conversationId: z.uuid(),
			editionId: z.uuid(),
			maxPosition: z.number().int().nullable(),
			mapFingerprint: z.string().max(128),
		}),
	)
	.handler(({ data }) => getGuideStep(appContext().db, data));

/**
 * The current rows behind a stored observation lookup's items, within the
 * conversation's scope, so the trail can offer "Correct this"; null for an
 * item whose row is no longer current.
 */
export const getTrailObservationsFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			conversationId: z.uuid(),
			editionId: z.uuid(),
			name: z.string().min(1).max(300),
			items: z
				.array(
					z.object({
						unitLabel: z.string().max(1000),
						observedAs: z.string().max(1000),
					}),
				)
				.max(50),
		}),
	)
	.handler(({ data }) => getTrailObservations(appContext().db, data));

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
