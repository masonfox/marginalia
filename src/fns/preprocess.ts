import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getPreprocessStatus } from "#/modules/analysis";
import { getEditionDetail } from "#/modules/library";
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
		const table = priceTable(config.ai?.prices);
		const rows = await usageForEdition(db, data.editionId);
		const total = totalOf({ byMessage: {}, byModel: rows, missing: 0 }, table);
		return {
			...status,
			aiEnabled: ai.status.enabled,
			configuredModel: ai.status.preprocessModel ?? null,
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
		if (!ai.status.enabled) throw new Error("AI is not configured.");
		const edition = await getEditionDetail(db, data.editionId);
		if (!edition || edition.status !== "ready")
			throw new Error("The book is not ready.");
		const id = await enqueue("analysis.preprocess", {
			editionId: data.editionId,
		});
		return { enqueued: id !== null };
	});
