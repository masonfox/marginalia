import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { listModels, type ModelList } from "#/modules/ai";
import {
	loadCredentials,
	resetChatDefault,
	resetPreprocessDefault,
	type SaveResult,
	saveChatDefault,
	savePreprocessDefault,
} from "#/modules/settings";
import { priceFor, priceTable } from "#/modules/usage";
import { AI_PROVIDERS } from "#/server/config";
import { appContext } from "#/server/context";

// Only server functions are exported here. The current defaults come from getAiStatusFn.

/**
 * A provider's models with known prices, cached briefly; `refresh` fetches
 * again. Never throws for a listing failure: the masked reason is in `error`.
 */
export const listModelsFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			provider: z.enum(AI_PROVIDERS),
			refresh: z.boolean().optional(),
		}),
	)
	.handler(async ({ data }): Promise<ModelList> => {
		const { config, db } = appContext();
		const credentials = (await loadCredentials(db, config.secretKey))[
			data.provider
		];
		if (!credentials)
			return { models: [], error: "This provider is not configured." };
		const table = priceTable(config.ai?.prices);
		return listModels(data.provider, credentials, {
			refresh: data.refresh,
			priceOf: (model) => priceFor(model, table),
		});
	});

// The selection is checked by the settings module, so a bad one is reported, not thrown.
const looseSelection = z.object({ provider: z.string(), model: z.string() });

/** Saves the chat default. Returns a reader-facing error when refused; nothing is stored then. */
export const saveChatDefaultFn = createServerFn({ method: "POST" })
	.validator(z.object({ selection: looseSelection }))
	.handler(async ({ data }) => {
		const { db, ai } = appContext();
		return saveOutcome(await saveChatDefault(db, ai, data.selection));
	});

/** Saves the preprocessing default: a model selection, or "same-as-chat". */
export const savePreprocessDefaultFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			selection: z.union([z.literal("same-as-chat"), looseSelection]),
		}),
	)
	.handler(async ({ data }) => {
		const { db, ai } = appContext();
		return saveOutcome(await savePreprocessDefault(db, ai, data.selection));
	});

/** Removes the saved chat default, so the environment's applies again. */
export const resetChatDefaultFn = createServerFn({ method: "POST" }).handler(
	async () => {
		await resetChatDefault(appContext().db);
	},
);

/** Removes the saved preprocessing default, so the environment's applies again. */
export const resetPreprocessDefaultFn = createServerFn({
	method: "POST",
}).handler(async () => {
	await resetPreprocessDefault(appContext().db);
});

function saveOutcome(result: SaveResult): { error: string | null } {
	switch (result.status) {
		case "ok":
			return { error: null };
		case "invalid":
			return { error: result.message };
		case "unavailable":
			return {
				error: `The provider ${result.provider} is not configured. Add its credentials to the environment first.`,
			};
	}
}
