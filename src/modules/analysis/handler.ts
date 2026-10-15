import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import { describeError } from "#/modules/ai";
import { getReadingUnits } from "#/modules/catalog";
import type { Database } from "#/server/db";
import { NonRetryableError } from "#/server/jobs/kinds";
import { type ProcessDeps, processUnit } from "./process";
import {
	claimRun,
	getBookMap,
	getCurrentUnits,
	lockStructureGeneration,
	StructureChangedError,
	saveUnitResult,
	updateRun,
} from "./queries";

const RUN_RELEASED = "The preprocessing run was cancelled or replaced.";

export interface PreprocessDeps {
	db: Database;
	/** Null when AI is not configured. */
	model: LanguageModel | null;
	modelName: string;
	provider: string;
	log: { info(o: object, m: string): void; warn(o: object, m: string): void };
	chunkChars?: number;
	reasoning?: ProcessDeps["reasoning"];
	providerOptions?: ProcessDeps["providerOptions"];
}

/**
 * The `analysis.preprocess` handler. Skips units that are already current,
 * processes the rest in order, and throws after the loop if any failed so a
 * retry only repeats the unfinished ones. Every exit after the start leaves
 * the run inactive, and every error it stores or throws is masked for
 * credentials. Units, passages, and saves are all fenced on the edition's
 * structure generation: if a reparse replaces the structure mid-run, nothing
 * more is saved and the run fails retryably, so the retry starts over from
 * the new structure. A run cancelled from outside (see cancelRun) stops after
 * the unit in progress, or sooner when the job's signal aborts.
 */
export async function preprocessEdition(
	deps: PreprocessDeps,
	editionId: string,
	ctx: { signal?: AbortSignal } = {},
): Promise<void> {
	const { db, log } = deps;
	if (!deps.model) {
		throw new NonRetryableError("AI is not configured; cannot preprocess");
	}
	// One snapshot of units and current results, all from the same structure.
	const snapshot = await db.transaction(async (tx) => {
		const generation = await lockStructureGeneration(tx, editionId);
		if (generation === null) return null;
		return {
			generation,
			units: await getReadingUnits(tx, editionId),
			current: await getCurrentUnits(tx, editionId),
			map: await getBookMap(tx, editionId, null),
		};
	});
	if (!snapshot) {
		throw new NonRetryableError("The book no longer exists");
	}
	const { generation, units } = snapshot;
	const currentEnd = new Map(
		snapshot.current.map((c) => [c.unitOrdinal, c.endPosition]),
	);
	const summaries = new Map(
		snapshot.map.map((s) => [s.unitOrdinal, s.summary]),
	);
	const isCurrent = (u: { ordinal: number; endPosition: number }) =>
		currentEnd.get(u.ordinal) === u.endPosition;
	let done = units.filter(isCurrent).length;
	let failed = 0;
	let lastError: string | null = null;
	// Later writes are ignored once a newer attempt claims the row.
	const attempt = randomUUID();
	await claimRun(db, editionId, attempt, {
		status: "running",
		totalUnits: units.length,
		doneUnits: done,
		failedUnits: 0,
		model: deps.modelName,
		lastError: null,
		startedAt: new Date(),
		finishedAt: null,
	});
	const processDeps: ProcessDeps = {
		db,
		model: deps.model,
		modelName: deps.modelName,
		provider: deps.provider,
		editionId,
		structureGeneration: generation,
		chunkChars: deps.chunkChars,
		signal: ctx.signal,
		reasoning: deps.reasoning,
		providerOptions: deps.providerOptions,
		log,
	};
	try {
		let previous: string | null = null;
		for (const unit of units) {
			if (isCurrent(unit)) {
				previous = summaries.get(unit.ordinal) ?? previous;
				continue;
			}
			ctx.signal?.throwIfAborted();
			try {
				const result = await processUnit(processDeps, unit, previous);
				await db.transaction((tx) =>
					saveUnitResult(tx, editionId, result, generation),
				);
				previous = result.summary;
				done += 1;
			} catch (err) {
				if (ctx.signal?.aborted || err instanceof StructureChangedError) {
					throw err;
				}
				failed += 1;
				// Providers may echo credentials; only the masked message is kept.
				lastError = describeError(err);
				log.warn(
					{ editionId, unit: unit.label, error: lastError },
					"unit preprocessing failed",
				);
			}
			const owned = await updateRun(
				db,
				editionId,
				{ doneUnits: done, failedUnits: failed, lastError },
				attempt,
			);
			if (!owned) {
				// Cancelled, or superseded by a newer attempt; either way spend no more.
				log.info({ editionId }, "preprocessing run released; stopping");
				throw new NonRetryableError(RUN_RELEASED);
			}
		}
	} catch (err) {
		// Ends this attempt inactive and retryable; the queue shows any pending retry.
		const reason = ctx.signal?.aborted
			? "Preprocessing was interrupted."
			: describeError(err);
		if (err instanceof StructureChangedError) {
			// Everything this run loaded describes the old structure.
			log.info({ editionId }, "edition structure changed; run abandoned");
		}
		await updateRun(
			db,
			editionId,
			{
				status: "failed",
				doneUnits: done,
				failedUnits: failed,
				lastError: reason,
				finishedAt: new Date(),
			},
			attempt,
		).catch(() => {});
		throw err;
	}
	await updateRun(
		db,
		editionId,
		{
			status: failed > 0 ? "failed" : "complete",
			doneUnits: done,
			failedUnits: failed,
			lastError,
			finishedAt: new Date(),
		},
		attempt,
	);
	if (failed > 0) {
		throw new Error(`${failed} of ${units.length} units failed: ${lastError}`);
	}
	log.info({ editionId, units: units.length }, "edition preprocessed");
}
