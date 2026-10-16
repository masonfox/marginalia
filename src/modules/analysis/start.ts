// Choosing the model a preprocessing run uses, enqueuing the run with it, and reporting it.
import { eq } from "drizzle-orm";
import type { AiRuntime } from "#/modules/ai";
import {
	type AiDefaults,
	checkSelection,
	getAiDefaults,
} from "#/modules/settings";
import { AI_PROVIDERS, type AiSelection } from "#/server/config";
import type { Executor } from "#/server/db";
import type { Enqueue, PendingJobDetail } from "#/server/jobs/kinds";
import { getPreprocessStatus, type PreprocessStatus } from "./queries";
import { preprocessRuns } from "./schema";

type AiSource = Pick<AiRuntime, "available" | "envDefaults">;

/** The model a new run would use, or why there is none. */
export type PreprocessChoice =
	| { status: "ok"; selection: AiSelection }
	/** No provider has credentials. */
	| { status: "disabled" }
	/** No choice was given and there is no preprocessing default. */
	| { status: "no_model" }
	| { status: "invalid"; message: string }
	| { status: "unavailable"; selection: AiSelection };

/**
 * The model for a new run: the reader's choice, otherwise the current
 * preprocessing default. Either must name a provider with credentials.
 */
export async function choosePreprocessModel(
	db: Executor,
	ai: AiSource,
	choice?: AiSelection,
): Promise<PreprocessChoice> {
	if ((await ai.available()).length === 0) return { status: "disabled" };
	if (choice) {
		const checked = await checkSelection(ai, choice);
		if (checked.status === "unavailable")
			return { status: "unavailable", selection: choice };
		return checked;
	}
	const { preprocess } = await getAiDefaults(db, ai);
	if (!preprocess.selection) return { status: "no_model" };
	if (!preprocess.available)
		return { status: "unavailable", selection: preprocess.selection };
	return { status: "ok", selection: preprocess.selection };
}

export type StartPreprocessResult =
	| Exclude<PreprocessChoice, { status: "ok" }>
	| { status: "enqueued"; selection: AiSelection }
	/** A run is already queued or running and keeps its model; null when unknown. */
	| { status: "in_progress"; selection: AiSelection | null };

export interface StartPreprocessDeps {
	db: Executor;
	ai: AiSource;
	enqueue: Enqueue;
	pendingJobDetail: PendingJobDetail;
}

/**
 * Enqueues a run with the chosen model, fixed for every attempt. Nothing is
 * enqueued when no usable model resolves. A second request while a run is
 * pending enqueues nothing and reports the pending run's model.
 */
export async function startPreprocess(
	deps: StartPreprocessDeps,
	editionId: string,
	choice?: AiSelection,
): Promise<StartPreprocessResult> {
	const chosen = await choosePreprocessModel(deps.db, deps.ai, choice);
	if (chosen.status !== "ok") return chosen;
	const id = await deps.enqueue("analysis.preprocess", {
		editionId,
		...chosen.selection,
	});
	if (id !== null) return { status: "enqueued", selection: chosen.selection };
	return {
		status: "in_progress",
		selection: await pendingSelection(deps, editionId),
	};
}

/** The pending run's model: its job's, else the run row's (a job queued before runs carried one). */
async function pendingSelection(
	deps: Pick<StartPreprocessDeps, "db" | "pendingJobDetail">,
	editionId: string,
): Promise<AiSelection | null> {
	const job = await deps
		.pendingJobDetail("analysis.preprocess", { editionId })
		.catch(() => null);
	const queued = selectionOf(job?.payload?.provider, job?.payload?.model);
	if (queued) return queued;
	const [run] = await deps.db
		.select({ provider: preprocessRuns.provider, model: preprocessRuns.model })
		.from(preprocessRuns)
		.where(eq(preprocessRuns.editionId, editionId));
	return selectionOf(run?.provider, run?.model);
}

export interface PreprocessOverview extends PreprocessStatus {
	/** At least one provider has credentials. */
	aiEnabled: boolean;
	/** The preprocessing default, which a new run preselects. */
	preprocessDefault: AiDefaults["preprocess"];
}

/**
 * Status with the provider and model of the queued, running, or last run,
 * and the default a new run would preselect. Never includes credentials.
 */
export async function getPreprocessOverview(
	deps: Omit<StartPreprocessDeps, "enqueue">,
	editionId: string,
): Promise<PreprocessOverview> {
	const { db, ai } = deps;
	// The queue decides whether a run is pending; unknown falls back to the run row.
	const job = await deps
		.pendingJobDetail("analysis.preprocess", { editionId })
		.catch(() => undefined);
	const status = await getPreprocessStatus(
		db,
		editionId,
		job === undefined ? undefined : (job?.state ?? null),
	);
	// A pending job runs with its own model; the row records it only once claimed.
	const pending = selectionOf(job?.payload?.provider, job?.payload?.model);
	const defaults = await getAiDefaults(db, ai);
	return {
		...status,
		...(pending ?? {}),
		aiEnabled: (await ai.available()).length > 0,
		preprocessDefault: defaults.preprocess,
	};
}

function selectionOf(
	provider: string | null | undefined,
	model: string | null | undefined,
): AiSelection | null {
	const known = AI_PROVIDERS.find((p) => p === provider);
	return known && model ? { provider: known, model } : null;
}
