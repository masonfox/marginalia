import { purgeExpiredSessions } from "#/modules/access";
import type { AiRuntime } from "#/modules/ai";
import {
	choosePreprocessModel,
	markDerivedStale,
	preprocessEdition,
} from "#/modules/analysis";
import {
	type IngestDeps,
	ingestEdition,
	reparseEdition,
} from "#/modules/catalog";
import { rebaseGuideContexts, rebaseScopes } from "#/modules/conversation";
import { reanchor, rebaseReadingPositions } from "#/modules/guide";
import { scanLibraries } from "#/modules/library";
import { getAiDefaults } from "#/modules/settings";
import type { Executor } from "#/server/db";
import { appContext } from "../context";
import { type Enqueue, type JobHandlers, NonRetryableError } from "./kinds";

/**
 * Enqueues preprocessing after ingest only when AI is configured and auto
 * mode is on, with the preprocessing default. When that default does not
 * resolve, nothing is enqueued and a warning is logged.
 */
export async function enqueueAutoPreprocess(
	deps: {
		db: Executor;
		config: { preprocessAuto: boolean };
		ai: Pick<AiRuntime, "available">;
		enqueue: Enqueue;
		log: { warn(o: object, m: string): void };
	},
	editionId: string,
): Promise<boolean> {
	if (!deps.config.preprocessAuto) return false;
	const chosen = await choosePreprocessModel(deps.db, deps.ai);
	if (chosen.status !== "ok") {
		// Provider and model ids only; never credentials.
		deps.log.warn(
			{
				editionId,
				reason: chosen.status,
				...(chosen.status === "unavailable" ? chosen.selection : {}),
			},
			"automatic preprocessing skipped: no usable preprocessing model",
		);
		return false;
	}
	await deps.enqueue("analysis.preprocess", { editionId, ...chosen.selection });
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
			// Keeps conversation and reply bounds, the reading position and the guide's
			// reader anchors on the same text when a reparse shifts positions.
			onReplaced: async (tx, { editionId, rebase, forward }) => {
				await rebaseScopes(tx, editionId, rebase);
				await rebaseGuideContexts(tx, editionId, rebase);
				await rebaseReadingPositions(tx, editionId, rebase);
				await reanchor(tx, editionId, forward);
				// Derived summaries describe the old structure.
				await markDerivedStale(tx, editionId);
			},
			// Preprocessing starts after a successful ingest or reparse when enabled.
			onIngested: async (editionId) => {
				await enqueueAutoPreprocess(
					{ db, config, ai, enqueue, log },
					editionId,
				);
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
		"analysis.preprocess": async ({ editionId, provider, model }, ctx) => {
			const { db, ai, log } = appContext();
			// Fixed at enqueue, so every attempt uses it. A job queued before runs
			// carried a model uses the preprocessing default when it starts.
			const selection =
				provider && model
					? { provider, model }
					: (await getAiDefaults(db, ai)).preprocess.selection;
			if (!selection)
				throw new NonRetryableError("No preprocessing model is set.");
			// No fallback: an unavailable model fails the run without retry.
			const resolved = await ai.resolve(selection);
			const ok = resolved.ok ? resolved : undefined;
			await preprocessEdition(
				{
					db,
					model: ok?.model ?? null,
					modelName: selection.model,
					provider: selection.provider,
					log,
					reasoning: ai.reasoning,
					providerOptions: ok?.providerOptions,
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
