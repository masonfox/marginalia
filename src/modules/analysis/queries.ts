import { and, asc, count, eq, lte, sql } from "drizzle-orm";
import type { Executor } from "#/server/db";
import {
	type DerivedCitation,
	type ObservationKind,
	preprocessRuns,
	unitObservations,
	unitSummaries,
} from "./schema";

/** Bump when the preprocessing prompt or output schema changes; older rows read as stale. */
export const PREPROCESS_PROMPT_VERSION = 1;
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

/** Replaces one unit's summary and observations. Run inside a transaction. */
export async function saveUnitResult(
	tx: Executor,
	editionId: string,
	result: UnitResult,
): Promise<void> {
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
	status: "queued" | "running" | "complete" | "failed";
	totalUnits: number;
	doneUnits: number;
	failedUnits: number;
	model: string | null;
	lastError: string | null;
	startedAt: Date | null;
	finishedAt: Date | null;
}>;

/** Creates or updates the edition's single run row. */
export async function updateRun(
	db: Executor,
	editionId: string,
	progress: RunProgress,
): Promise<void> {
	await db
		.insert(preprocessRuns)
		.values({ editionId, status: "queued", ...progress })
		.onConflictDoUpdate({ target: preprocessRuns.editionId, set: progress });
}

export type PreprocessState =
	| "not_started"
	| "queued"
	| "running"
	| "complete"
	| "partial"
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

/** Status for display. Never includes credentials. */
export async function getPreprocessStatus(
	db: Executor,
	editionId: string,
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
	if (!run && current + outdated === 0) {
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
		lastError: run?.lastError ?? null,
		startedAt: run?.startedAt ?? null,
		finishedAt: run?.finishedAt ?? null,
	};
	let status: PreprocessState;
	if (run?.status === "queued" || run?.status === "running") {
		status = run.status;
	} else if (outdated > 0) {
		status = "stale";
	} else if (run?.status === "failed") {
		status = "partial";
	} else {
		status = "complete";
	}
	return { status, ...base };
}
