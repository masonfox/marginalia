import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { selectionSchema } from "#/modules/ai";
import {
	cancelRun,
	getPreprocessOverview,
	startPreprocess,
} from "#/modules/analysis";
import { getEditionDetail } from "#/modules/library";
import { priceTable, totalOf, usageForEdition } from "#/modules/usage";
import { appContext } from "#/server/context";

// Only server functions are exported here.

/**
 * Preprocessing state, the provider and model of the queued, running, or
 * last run, the default a new run would preselect, and spend for one book.
 * Never includes credentials.
 */
export const getPreprocessStatusFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(async ({ data }) => {
		const { db, ai, config, pendingJobDetail } = appContext();
		const overview = await getPreprocessOverview(
			{ db, ai, pendingJobDetail },
			data.editionId,
		);
		const table = priceTable(config.ai?.prices);
		const rows = await usageForEdition(db, data.editionId);
		const total = totalOf({ byMessage: {}, byModel: rows, missing: 0 }, table);
		return {
			...overview,
			spendUsd: rows.length === 0 ? 0 : total.estimatedCost,
			hasSpend: rows.length > 0,
			// Null when the provider never reported the count.
			inputTokens: total.inputTokens,
			outputTokens: total.outputTokens,
		};
	});

/**
 * Starts preprocessing with the reader's model, or the preprocessing default
 * when none is given; the choice applies to this run only. While a run is
 * pending nothing is enqueued, and the pending run's model is returned.
 */
export const startPreprocessFn = createServerFn({ method: "POST" })
	.validator(
		z.object({ editionId: z.uuid(), selection: selectionSchema.optional() }),
	)
	.handler(async ({ data }) => {
		const { db, ai, enqueue, pendingJobDetail } = appContext();
		if (ai.available().length === 0) throw new Error("AI is not configured.");
		const edition = await getEditionDetail(db, data.editionId);
		if (!edition || edition.status !== "ready")
			throw new Error("The book is not ready.");
		const result = await startPreprocess(
			{ db, ai, enqueue, pendingJobDetail },
			data.editionId,
			data.selection,
		);
		switch (result.status) {
			case "enqueued":
			case "in_progress":
				return {
					enqueued: result.status === "enqueued",
					selection: result.selection,
				};
			case "disabled":
				throw new Error("AI is not configured.");
			case "no_model":
				throw new Error(
					"No preprocessing model is set. Choose one, or set a default in Settings.",
				);
			case "invalid":
				throw new Error(result.message);
			case "unavailable":
				throw new Error(
					`Model ${result.selection.provider}/${result.selection.model} is unavailable.`,
				);
		}
	});

/** Stops a queued or running preprocessing job. Sections already saved are kept. */
export const cancelPreprocessFn = createServerFn({ method: "POST" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(async ({ data }) => {
		const { db, cancelJob } = appContext();
		// The job first, so no retry can claim the run after it is marked cancelled.
		const cancelled = await cancelJob("analysis.preprocess", {
			editionId: data.editionId,
		});
		// The exclusive queue holds at most one live job per edition.
		await cancelRun(db, data.editionId, cancelled[0] ?? null);
		return { cancelled: cancelled.length > 0 };
	});
