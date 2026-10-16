import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cancelRun, getPreprocessStatus } from "#/modules/analysis";
import { getEditionDetail } from "#/modules/library";
import { getAiDefaults } from "#/modules/settings";
import { priceTable, totalOf, usageForEdition } from "#/modules/usage";
import { appContext } from "#/server/context";

// Only server functions are exported here.

/** Preprocessing state, model and spend for one book. Never includes credentials. */
export const getPreprocessStatusFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(async ({ data }) => {
		const { db, ai, config, pendingJob } = appContext();
		// The queue decides whether a run is pending; unknown falls back to the run row.
		const job = await pendingJob("analysis.preprocess", {
			editionId: data.editionId,
		}).catch(() => undefined);
		const status = await getPreprocessStatus(db, data.editionId, job);
		const defaults = await getAiDefaults(db, ai);
		const table = priceTable(config.ai?.prices);
		const rows = await usageForEdition(db, data.editionId);
		const total = totalOf({ byMessage: {}, byModel: rows, missing: 0 }, table);
		return {
			...status,
			aiEnabled: ai.available().length > 0,
			configuredModel: defaults.preprocess.selection?.model ?? null,
			spendUsd: rows.length === 0 ? 0 : total.estimatedCost,
			hasSpend: rows.length > 0,
			// Null when the provider never reported the count.
			inputTokens: total.inputTokens,
			outputTokens: total.outputTokens,
		};
	});

export const startPreprocessFn = createServerFn({ method: "POST" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(async ({ data }) => {
		const { db, ai, enqueue } = appContext();
		if (ai.available().length === 0) throw new Error("AI is not configured.");
		const edition = await getEditionDetail(db, data.editionId);
		if (!edition || edition.status !== "ready")
			throw new Error("The book is not ready.");
		const id = await enqueue("analysis.preprocess", {
			editionId: data.editionId,
		});
		return { enqueued: id !== null };
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
