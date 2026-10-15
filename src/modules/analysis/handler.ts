import type { LanguageModel } from "ai";
import { getReadingUnits } from "#/modules/catalog";
import type { Database } from "#/server/db";
import { NonRetryableError } from "#/server/jobs/kinds";
import { type ProcessDeps, processUnit } from "./process";
import {
	getBookMap,
	getCurrentUnits,
	lockStructureGeneration,
	StructureChangedError,
	saveUnitResult,
	updateRun,
} from "./queries";

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
 * retry only repeats the unfinished ones. Units, passages, and saves are all
 * fenced on the edition's structure generation: if a reparse replaces the
 * structure mid-run, nothing more is saved and the run fails retryably, so
 * the retry starts over from the new structure.
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
	await updateRun(db, editionId, {
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
	};
	let failed = 0;
	let lastError: string | null = null;
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
			if (ctx.signal?.aborted) throw err;
			if (err instanceof StructureChangedError) {
				// Everything this run loaded describes the old structure.
				await updateRun(db, editionId, {
					status: "failed",
					doneUnits: done,
					failedUnits: failed,
					lastError: err.message,
					finishedAt: new Date(),
				});
				log.info({ editionId }, "edition structure changed; run abandoned");
				throw err;
			}
			failed += 1;
			lastError = err instanceof Error ? err.message : String(err);
			log.warn(
				{ editionId, unit: unit.label, err },
				"unit preprocessing failed",
			);
		}
		await updateRun(db, editionId, {
			doneUnits: done,
			failedUnits: failed,
			lastError,
		});
	}
	await updateRun(db, editionId, {
		status: failed > 0 ? "failed" : "complete",
		doneUnits: done,
		failedUnits: failed,
		lastError,
		finishedAt: new Date(),
	});
	if (failed > 0) {
		throw new Error(`${failed} of ${units.length} units failed: ${lastError}`);
	}
	log.info({ editionId, units: units.length }, "edition preprocessed");
}
