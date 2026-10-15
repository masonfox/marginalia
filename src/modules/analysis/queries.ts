import { and, asc, count, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { redactSecrets } from "#/modules/ai";
import { getReadingUnits } from "#/modules/catalog";
import { editions } from "#/modules/library";
import type { Executor } from "#/server/db";
import {
	type DerivedCitation,
	type ObservationKind,
	preprocessRuns,
	unitObservations,
	unitSummaries,
} from "./schema";

/** Bump when the preprocessing prompt or output schema changes; older rows read as stale. */
export const PREPROCESS_PROMPT_VERSION = 2;
/** Bump when the reading-unit or citation handling changes. */
export const PREPROCESS_PARSER_VERSION = 1;

/** Cap on observations a lookup returns, whatever the caller asks for. */
export const MAX_LOOKUP_LIMIT = 50;

export interface UnitSummaryView {
	unitOrdinal: number;
	unitLabel: string;
	endPosition: number;
	summary: string;
	citations: DerivedCitation[];
}

export interface ObservationView {
	unitOrdinal: number;
	endPosition: number;
	name: string;
	kind: ObservationKind;
	note: string;
	citations: DerivedCitation[];
}

/** Normalizes a name for lookup: case, accents, punctuation, and spacing. */
export function normalizeNameKey(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

const currentSummary = (editionId: string) =>
	and(
		eq(unitSummaries.editionId, editionId),
		eq(unitSummaries.stale, false),
		eq(unitSummaries.promptVersion, PREPROCESS_PROMPT_VERSION),
	);

/** `bound` null means the whole book. A unit ending after the bound is excluded even if the bound is inside it. */
export async function getBookMap(
	db: Executor,
	editionId: string,
	bound: number | null,
): Promise<UnitSummaryView[]> {
	return db
		.select({
			unitOrdinal: unitSummaries.unitOrdinal,
			unitLabel: unitSummaries.unitLabel,
			endPosition: unitSummaries.endPosition,
			summary: unitSummaries.summary,
			citations: unitSummaries.citations,
		})
		.from(unitSummaries)
		.where(
			and(
				currentSummary(editionId),
				bound === null ? undefined : lte(unitSummaries.endPosition, bound),
			),
		)
		.orderBy(asc(unitSummaries.unitOrdinal));
}

/** Observations of one subject (matched by normalized name) in reading order, capped. */
export async function lookupObservations(
	db: Executor,
	editionId: string,
	name: string,
	bound: number | null,
	limit: number,
): Promise<ObservationView[]> {
	const key = normalizeNameKey(name);
	const cap = Math.max(0, Math.min(Math.floor(limit), MAX_LOOKUP_LIMIT));
	if (!key || cap === 0) return [];
	return db
		.select({
			unitOrdinal: unitObservations.unitOrdinal,
			endPosition: unitObservations.endPosition,
			name: unitObservations.name,
			kind: unitObservations.kind,
			note: unitObservations.note,
			citations: unitObservations.citations,
		})
		.from(unitObservations)
		.where(
			and(
				eq(unitObservations.editionId, editionId),
				eq(unitObservations.nameKey, key),
				eq(unitObservations.stale, false),
				eq(unitObservations.promptVersion, PREPROCESS_PROMPT_VERSION),
				bound === null ? undefined : lte(unitObservations.endPosition, bound),
			),
		)
		.orderBy(asc(unitObservations.endPosition), asc(unitObservations.id))
		.limit(cap);
}

/** A current summary with the provenance the Guide shows. */
export interface SummaryRow extends UnitSummaryView {
	model: string;
	promptVersion: number;
}

/** A current observation row, for the Guide's merged view. */
export interface ObservationRow extends ObservationView {
	nameKey: string;
}

/** Current summaries ending at or before `bound` (null: whole book), in reading order. */
export async function listSummaries(
	db: Executor,
	editionId: string,
	bound: number | null,
): Promise<SummaryRow[]> {
	return db
		.select({
			unitOrdinal: unitSummaries.unitOrdinal,
			unitLabel: unitSummaries.unitLabel,
			endPosition: unitSummaries.endPosition,
			summary: unitSummaries.summary,
			citations: unitSummaries.citations,
			model: unitSummaries.model,
			promptVersion: unitSummaries.promptVersion,
		})
		.from(unitSummaries)
		.where(
			and(
				currentSummary(editionId),
				bound === null ? undefined : lte(unitSummaries.endPosition, bound),
			),
		)
		.orderBy(asc(unitSummaries.unitOrdinal));
}

const currentObservation = (editionId: string, bound: number | null) =>
	and(
		eq(unitObservations.editionId, editionId),
		eq(unitObservations.stale, false),
		eq(unitObservations.promptVersion, PREPROCESS_PROMPT_VERSION),
		bound === null ? undefined : lte(unitObservations.endPosition, bound),
	);

/**
 * Current observations ending at or before `bound` (null: whole book), in
 * reading order, optionally only those of `nameKeys`. Uncapped: the Guide
 * shows a subject's whole timeline.
 */
export async function listObservations(
	db: Executor,
	editionId: string,
	bound: number | null,
	nameKeys?: string[],
): Promise<ObservationRow[]> {
	if (nameKeys?.length === 0) return [];
	return db
		.select({
			unitOrdinal: unitObservations.unitOrdinal,
			endPosition: unitObservations.endPosition,
			name: unitObservations.name,
			nameKey: unitObservations.nameKey,
			kind: unitObservations.kind,
			note: unitObservations.note,
			citations: unitObservations.citations,
		})
		.from(unitObservations)
		.where(
			and(
				currentObservation(editionId, bound),
				nameKeys ? inArray(unitObservations.nameKey, nameKeys) : undefined,
			),
		)
		.orderBy(asc(unitObservations.endPosition), asc(unitObservations.id));
}

/** One observed name in one unit: the Index listing's grain. */
export interface ObservedName {
	nameKey: string;
	/** One of the names observed under the key in the unit. */
	name: string;
	unitOrdinal: number;
	endPosition: number;
	/** The kind of each observation of the key in the unit. */
	kinds: ObservationKind[];
}

/**
 * Distinct observed names per unit, for current observations ending at or
 * before `bound` (null: whole book), in reading order.
 */
export async function listObservedNames(
	db: Executor,
	editionId: string,
	bound: number | null,
): Promise<ObservedName[]> {
	return db
		.select({
			nameKey: unitObservations.nameKey,
			name: sql<string>`min(${unitObservations.name})`,
			unitOrdinal: unitObservations.unitOrdinal,
			endPosition: unitObservations.endPosition,
			kinds: sql<ObservationKind[]>`array_agg(${unitObservations.kind})`,
		})
		.from(unitObservations)
		.where(currentObservation(editionId, bound))
		.groupBy(
			unitObservations.nameKey,
			unitObservations.unitOrdinal,
			unitObservations.endPosition,
		)
		.orderBy(asc(unitObservations.endPosition), asc(unitObservations.nameKey));
}

/** Whether the edition has at least one current summary. */
export async function hasCurrentPreprocessing(
	db: Executor,
	editionId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ n: count() })
		.from(unitSummaries)
		.where(currentSummary(editionId));
	return (row?.n ?? 0) > 0;
}

export interface UnitResult {
	unitOrdinal: number;
	unitLabel: string;
	endPosition: number;
	summary: string;
	summaryCitations: DerivedCitation[];
	observations: {
		name: string;
		kind: ObservationKind;
		note: string;
		citations: DerivedCitation[];
	}[];
	model: string;
}

/** The edition's structure was replaced after a preprocessing run loaded it. */
export class StructureChangedError extends Error {
	constructor() {
		super("The book's structure changed during preprocessing");
		this.name = "StructureChangedError";
	}
}

/**
 * Returns the edition's structure generation, or null when it was deleted.
 * Inside a transaction, the row lock conflicts with the one
 * replaceEditionStructure takes, so the structure cannot change until commit.
 */
export async function lockStructureGeneration(
	tx: Executor,
	editionId: string,
): Promise<number | null> {
	const [row] = await tx
		.select({ generation: editions.structureGeneration })
		.from(editions)
		.where(eq(editions.id, editionId))
		.for("share");
	return row?.generation ?? null;
}

/** Locks the structure and throws StructureChangedError unless it is still `generation`. */
export async function assertStructureGeneration(
	tx: Executor,
	editionId: string,
	generation: number,
): Promise<void> {
	if ((await lockStructureGeneration(tx, editionId)) !== generation) {
		throw new StructureChangedError();
	}
}

/**
 * Replaces one unit's summary and observations. Run inside a transaction.
 * With `generation`, first checks that the result was computed from the
 * edition's current structure, throwing StructureChangedError otherwise.
 */
export async function saveUnitResult(
	tx: Executor,
	editionId: string,
	result: UnitResult,
	generation?: number,
): Promise<void> {
	if (generation !== undefined) {
		await assertStructureGeneration(tx, editionId, generation);
	}
	const provenance = {
		editionId,
		unitOrdinal: result.unitOrdinal,
		endPosition: result.endPosition,
		model: result.model,
		promptVersion: PREPROCESS_PROMPT_VERSION,
		parserVersion: PREPROCESS_PARSER_VERSION,
		stale: false,
	};
	await tx
		.delete(unitSummaries)
		.where(
			and(
				eq(unitSummaries.editionId, editionId),
				eq(unitSummaries.unitOrdinal, result.unitOrdinal),
			),
		);
	await tx
		.delete(unitObservations)
		.where(
			and(
				eq(unitObservations.editionId, editionId),
				eq(unitObservations.unitOrdinal, result.unitOrdinal),
			),
		);
	await tx.insert(unitSummaries).values({
		...provenance,
		unitLabel: result.unitLabel,
		summary: result.summary,
		citations: result.summaryCitations,
	});
	if (result.observations.length > 0) {
		await tx.insert(unitObservations).values(
			result.observations.map((o) => ({
				...provenance,
				name: o.name,
				nameKey: normalizeNameKey(o.name),
				kind: o.kind,
				note: o.note,
				citations: o.citations,
			})),
		);
	}
}

/** Marks every derived row of the edition stale (called inside the reparse transaction). */
export async function markDerivedStale(
	tx: Executor,
	editionId: string,
): Promise<void> {
	await tx
		.update(unitSummaries)
		.set({ stale: true })
		.where(eq(unitSummaries.editionId, editionId));
	await tx
		.update(unitObservations)
		.set({ stale: true })
		.where(eq(unitObservations.editionId, editionId));
}

/** Stored (ordinal, end position) of units that already have a current summary, for skipping. */
export async function getCurrentUnits(
	db: Executor,
	editionId: string,
): Promise<{ unitOrdinal: number; endPosition: number }[]> {
	return db
		.select({
			unitOrdinal: unitSummaries.unitOrdinal,
			endPosition: unitSummaries.endPosition,
		})
		.from(unitSummaries)
		.where(currentSummary(editionId));
}

export type RunProgress = Partial<{
	status: "queued" | "running" | "complete" | "failed" | "cancelled";
	totalUnits: number;
	doneUnits: number;
	failedUnits: number;
	model: string | null;
	attemptId: string | null;
	lastError: string | null;
	startedAt: Date | null;
	finishedAt: Date | null;
}>;

/**
 * Creates or updates the edition's single run row. With `attempt`, only
 * updates the row while that attempt still owns it, so an obsolete attempt
 * never overwrites a newer one; see claimRun. Returns false when `attempt`
 * no longer owns the row (superseded or cancelled), true otherwise.
 */
export async function updateRun(
	db: Executor,
	editionId: string,
	progress: RunProgress,
	attempt?: string,
): Promise<boolean> {
	if (attempt !== undefined) {
		const owned = await db
			.update(preprocessRuns)
			.set(progress)
			.where(
				and(
					eq(preprocessRuns.editionId, editionId),
					eq(preprocessRuns.attemptId, attempt),
				),
			)
			.returning({ editionId: preprocessRuns.editionId });
		return owned.length > 0;
	}
	await db
		.insert(preprocessRuns)
		.values({ editionId, status: "queued", ...progress })
		.onConflictDoUpdate({ target: preprocessRuns.editionId, set: progress });
	return true;
}

/**
 * Makes `attempt` of queue job `jobId` the run row's owner and writes
 * `progress`, unless cancelRun already fenced out that job. One statement, so
 * a cancellation that lands first always wins. A claim never lifts a fence,
 * so a cancelled job cannot take the run back from a newer one, whether that
 * job claimed or was cancelled too. Returns whether it claimed.
 */
export async function claimRun(
	db: Executor,
	editionId: string,
	jobId: string,
	attempt: string,
	progress: RunProgress,
): Promise<boolean> {
	const set = { ...progress, attemptId: attempt };
	const claimed = await db
		.insert(preprocessRuns)
		.values({ editionId, status: "queued", ...set })
		.onConflictDoUpdate({
			target: preprocessRuns.editionId,
			set,
			setWhere: sql`not (${jobId}::uuid = any(${preprocessRuns.cancelledJobIds}))`,
		})
		.returning({ editionId: preprocessRuns.editionId });
	return claimed.length > 0;
}

/**
 * Marks an unfinished run cancelled and releases it from its attempt, so a
 * still-running attempt stops at its next progress write and cannot
 * overwrite the cancellation. Units already saved are kept. With
 * `cancelledJobId`, also adds that job to the run's fence so claimRun refuses
 * it (fencing only that job), recording a cancelled row when the job was
 * cancelled before it wrote one. A book deleted meanwhile has nothing to
 * cancel.
 */
export async function cancelRun(
	db: Executor,
	editionId: string,
	cancelledJobId: string | null,
): Promise<void> {
	if (cancelledJobId !== null) {
		// The fence first: a later claim by the job is refused, and an earlier
		// one is released by the update below. A complete run keeps its status.
		try {
			await fenceJob(db, editionId, cancelledJobId);
		} catch (err) {
			// The book was deleted after the existence check; its run went with it.
			// Inside a transaction this failure would abort it, so callers pass db.
			if (!isForeignKeyViolation(err)) throw err;
		}
	}
	await db
		.update(preprocessRuns)
		.set({
			status: "cancelled",
			attemptId: null,
			lastError: null,
			finishedAt: new Date(),
		})
		.where(
			and(
				eq(preprocessRuns.editionId, editionId),
				ne(preprocessRuns.status, "complete"),
			),
		);
}

/**
 * Cancelled jobs kept in a run's fence. A cancelled job's worker only
 * survives until its next heartbeat abort, so a short list suffices.
 */
const FENCED_JOBS = 20;

/** Adds `jobId` to the run's fence, recording a cancelled row if there is none. */
async function fenceJob(
	db: Executor,
	editionId: string,
	jobId: string,
): Promise<void> {
	const [[edition], units, current] = await Promise.all([
		db
			.select({ id: editions.id })
			.from(editions)
			.where(eq(editions.id, editionId)),
		getReadingUnits(db, editionId),
		getCurrentUnits(db, editionId),
	]);
	// A deleted book has no run left to fence.
	if (!edition) return;
	// Newest first, so the slice drops the oldest.
	await db
		.insert(preprocessRuns)
		.values({
			editionId,
			status: "cancelled",
			totalUnits: units.length,
			doneUnits: current.length,
			cancelledJobIds: [jobId],
			finishedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: preprocessRuns.editionId,
			set: {
				cancelledJobIds: sql`(array_prepend(${jobId}::uuid, ${preprocessRuns.cancelledJobIds}))[1:${sql.raw(String(FENCED_JOBS))}]`,
			},
		});
}

/** Whether `err`, or any error in its cause chain, is a Postgres foreign-key violation. */
function isForeignKeyViolation(err: unknown): boolean {
	for (let e: unknown = err; e instanceof Error; e = e.cause) {
		if ((e as { code?: unknown }).code === "23503") return true;
	}
	return false;
}

export type PreprocessState =
	| "not_started"
	| "queued"
	| "running"
	| "complete"
	| "partial"
	| "cancelled"
	| "stale";

export interface PreprocessStatus {
	status: PreprocessState;
	totalUnits: number;
	doneUnits: number;
	failedUnits: number;
	model: string | null;
	lastError: string | null;
	startedAt: Date | null;
	finishedAt: Date | null;
}

/**
 * The edition's preprocessing job in the queue: waiting (including between
 * retries), being worked on, or none. Undefined when the queue is unknown.
 */
export type QueuedJobState = "queued" | "active" | null;

/** Shown when a run was left active by an attempt that no longer exists. */
export const INTERRUPTED_RUN_ERROR =
	"Preprocessing stopped before it finished.";

/**
 * Status for display. Never includes credentials. With `job`, the queue is
 * the authority on whether a run is pending: an accepted job reads as queued
 * before any worker writes, and a run row left active by an attempt that no
 * longer exists (aborted, crashed) reads as a retryable terminal state.
 */
export async function getPreprocessStatus(
	db: Executor,
	editionId: string,
	job?: QueuedJobState,
): Promise<PreprocessStatus> {
	const [run] = await db
		.select()
		.from(preprocessRuns)
		.where(eq(preprocessRuns.editionId, editionId));
	const [counts] = await db
		.select({
			current: sql<number>`count(*) filter (where ${unitSummaries.stale} = false and ${unitSummaries.promptVersion} = ${PREPROCESS_PROMPT_VERSION})::int`,
			outdated: sql<number>`count(*) filter (where ${unitSummaries.stale} = true or ${unitSummaries.promptVersion} <> ${PREPROCESS_PROMPT_VERSION})::int`,
		})
		.from(unitSummaries)
		.where(eq(unitSummaries.editionId, editionId));
	const current = counts?.current ?? 0;
	const outdated = counts?.outdated ?? 0;
	const live = run?.status === "queued" || run?.status === "running";
	const orphaned = live && job === null;
	if (!run && current + outdated === 0 && !job) {
		return {
			status: "not_started",
			totalUnits: 0,
			doneUnits: 0,
			failedUnits: 0,
			model: null,
			lastError: null,
			startedAt: null,
			finishedAt: null,
		};
	}
	const base = {
		totalUnits: run?.totalUnits ?? current + outdated,
		doneUnits: current,
		failedUnits: run?.failedUnits ?? 0,
		model: run?.model ?? null,
		lastError: run?.lastError
			? redactSecrets(run.lastError)
			: orphaned
				? INTERRUPTED_RUN_ERROR
				: null,
		startedAt: run?.startedAt ?? null,
		finishedAt: run?.finishedAt ?? null,
	};
	let status: PreprocessState;
	if (job === "active") {
		// The worker may not have written its row yet.
		status = run?.status === "running" ? "running" : "queued";
	} else if (job === "queued") {
		status = "queued";
	} else if (
		job === undefined &&
		(run?.status === "queued" || run?.status === "running")
	) {
		status = run.status;
	} else if (run?.status === "cancelled") {
		status = "cancelled";
	} else if (outdated > 0) {
		status = "stale";
	} else if (run?.status === "failed" || orphaned) {
		status = "partial";
	} else {
		status = "complete";
	}
	return { status, ...base };
}
