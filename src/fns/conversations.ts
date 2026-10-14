import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	createConversationForEdition,
	deleteConversation,
	getConversationWithUsage,
	listConversationsForEdition,
	renameConversation,
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

/** Starts a single-book conversation. Returns null when the book is missing or not ready. */
export const createConversationFn = createServerFn({ method: "POST" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(({ data }) =>
		createConversationForEdition(appContext().db, data.editionId),
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
