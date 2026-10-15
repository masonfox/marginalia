import { purgeExpiredSessions } from "#/modules/access";
import { markDerivedStale, preprocessEdition } from "#/modules/analysis";
import {
	type IngestDeps,
	ingestEdition,
	reparseEdition,
} from "#/modules/catalog";
import { rebaseScopes } from "#/modules/conversation";
import { reanchor, rebaseReadingPositions } from "#/modules/guide";
import { scanLibraries } from "#/modules/library";
import { appContext } from "../context";
import type { JobHandlers } from "./kinds";

/** Enqueues preprocessing after ingest only when AI is configured and auto mode is on. */
export async function enqueueAutoPreprocess(
	deps: {
		config: { preprocessAuto: boolean };
		ai: { status: { enabled: boolean } };
		enqueue: (
			kind: "analysis.preprocess",
			p: { editionId: string },
		) => Promise<unknown>;
	},
	editionId: string,
): Promise<boolean> {
	if (!deps.config.preprocessAuto || !deps.ai.status.enabled) return false;
	await deps.enqueue("analysis.preprocess", { editionId });
	return true;
}

/** Wires each job kind to the module that handles it. */
export function jobHandlers(): JobHandlers {
	const ingestDeps = () => {
		const { db, config, log, ai, enqueue } = appContext();
		return {
			db,
			dataDir: config.dataDir,
			log,
			// Keeps conversation bounds, the reading position and the guide's
			// reader anchors on the same text when a reparse shifts positions.
			onReplaced: async (tx, { editionId, rebase, forward }) => {
				await rebaseScopes(tx, editionId, rebase);
				await rebaseReadingPositions(tx, editionId, rebase);
				await reanchor(tx, editionId, forward);
				// Derived summaries describe the old structure.
				await markDerivedStale(tx, editionId);
			},
			// Preprocessing starts after a successful ingest or reparse when enabled.
			onIngested: async (editionId) => {
				await enqueueAutoPreprocess({ config, ai, enqueue }, editionId);
			},
		} satisfies IngestDeps;
	};
	return {
		"library.scan": async ({ full }) => {
			const { db, config, enqueue, log } = appContext();
			await scanLibraries(
				{ db, libraryPaths: config.libraryPaths, enqueue, log },
				{ full },
			);
		},
		"library.ingest": async ({ sha256 }, ctx) => {
			await ingestEdition(ingestDeps(), sha256, ctx);
		},
		"catalog.reparse": async ({ editionId }, ctx) => {
			await reparseEdition(ingestDeps(), editionId, ctx);
		},
		"analysis.preprocess": async ({ editionId }, ctx) => {
			const { db, ai, log } = appContext();
			await preprocessEdition(
				{
					db,
					model: ai.preprocessModel,
					modelName: ai.status.preprocessModel ?? "unknown",
					provider: ai.status.provider ?? "unknown",
					log,
					reasoning: ai.reasoning,
					providerOptions: ai.providerOptions,
				},
				editionId,
				{ id: ctx.id, signal: ctx.signal },
			);
		},
		"access.purge-sessions": async () => {
			const { db, log } = appContext();
			log.info(
				{ purged: await purgeExpiredSessions(db) },
				"expired sessions purged",
			);
		},
	};
}
