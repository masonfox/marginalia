import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getPreprocessStatus } from "#/modules/analysis";
import { getEditionDetail } from "#/modules/library";
import { estimateCost, priceTable, usageForEdition } from "#/modules/usage";
import { appContext } from "#/server/context";

// Only server functions are exported here.

/** Preprocessing state, model and spend for one book. Never includes credentials. */
export const getPreprocessStatusFn = createServerFn({ method: "GET" })
	.validator(z.object({ editionId: z.uuid() }))
	.handler(async ({ data }) => {
		const { db, ai, config } = appContext();
		const status = await getPreprocessStatus(db, data.editionId);
		const table = priceTable(config.ai?.prices);
		const rows = await usageForEdition(db, data.editionId);
		let cost: number | null = 0;
		for (const r of rows) {
			const c = estimateCost(r, r.model, table);
			cost = cost === null || c === null ? null : cost + c;
		}
		return {
			...status,
			aiEnabled: ai.status.enabled,
			configuredModel: ai.status.preprocessModel ?? null,
			spendUsd: rows.length === 0 ? 0 : cost,
			hasSpend: rows.length > 0,
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
