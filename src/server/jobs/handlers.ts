import { purgeExpiredSessions } from "#/modules/access";
import { markDerivedStale, preprocessEdition } from "#/modules/analysis";
import {
	type IngestDeps,
	ingestEdition,
	reparseEdition,
} from "#/modules/catalog";
import { rebaseScopes } from "#/modules/conversation";
import { scanLibraries } from "#/modules/library";
import { appContext } from "../context";
import type { JobHandlers } from "./kinds";

/** Wires each job kind to the module that handles it. */
export function jobHandlers(): JobHandlers {
	const ingestDeps = () => {
		const { db, config, log, ai, enqueue } = appContext();
		return {
			db,
			dataDir: config.dataDir,
			log,
			// Keeps conversation bounds on the same text when a reparse shifts positions.
			onReplaced: async (tx, { editionId, rebase }) => {
				await rebaseScopes(tx, editionId, rebase);
				// Derived summaries describe the old structure.
				await markDerivedStale(tx, editionId);
			},
			// Preprocessing starts after a successful ingest or reparse when enabled.
			onIngested: async (editionId) => {
				if (!config.preprocessAuto || !ai.status.enabled) return;
				await enqueue("analysis.preprocess", { editionId });
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
				},
				editionId,
				{ signal: ctx.signal },
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
