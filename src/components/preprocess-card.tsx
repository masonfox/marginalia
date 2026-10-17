import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
	ModelChoice,
	replyModelLabel,
	selectionLabel,
} from "#/components/model-picker";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { getAiStatusFn } from "#/fns/conversations";
import {
	cancelPreprocessFn,
	getPreprocessStatusFn,
	startPreprocessFn,
} from "#/fns/preprocess";
import type { AiDefault } from "#/modules/settings";
import type { AiProviderName, AiSelection } from "#/server/config";

export interface PreprocessView {
	status:
		| "not_started"
		| "queued"
		| "running"
		| "complete"
		| "partial"
		| "cancelled"
		| "stale";
	totalUnits: number;
	doneUnits: number;
	failedUnits: number;
	/** Of the queued, running, or last run. */
	provider: string | null;
	model: string | null;
	lastError: string | null;
	aiEnabled: boolean;
	/** What a new run preselects. */
	preprocessDefault: Pick<AiDefault, "selection" | "available">;
	spendUsd: number | null;
	hasSpend: boolean;
	/** Null when unreported. */
	inputTokens: number | null;
	outputTokens: number | null;
}

const tokens = (n: number | null) =>
	n === null ? "unknown" : n.toLocaleString("en-US");

export const isActive = (s: PreprocessView["status"]) =>
	s === "queued" || s === "running";

const LABELS: Record<PreprocessView["status"], string> = {
	not_started: "Not started",
	queued: "Queued",
	running: "Running",
	complete: "Complete",
	partial: "Incomplete",
	cancelled: "Cancelled",
	stale: "Out of date",
};

/** Presentational card; the container below wires data and actions. */
export function PreprocessCardView({
	view,
	providers,
	choice = null,
	onChoiceChange,
	busy = false,
	error = null,
	onStart,
	onCancel,
}: {
	view: PreprocessView;
	/** Providers a run's model can use; the change control waits for them. */
	providers?: AiProviderName[];
	/** The model chosen for the next run; null uses the default. */
	choice?: AiSelection | null;
	onChoiceChange?: (choice: AiSelection | null) => void;
	busy?: boolean;
	error?: string | null;
	onStart?: () => void;
	onCancel?: () => void;
}) {
	// Without AI a book never preprocessed has nothing to show; one with a
	// run keeps its status, and a pending run stays cancellable.
	if (!view.aiEnabled && view.status === "not_started") return null;
	const active = isActive(view.status);
	const failed = view.failedUnits > 0 || view.lastError !== null;
	// A new run needs a provider; a stale choice or default cannot start one.
	const runnable = view.aiEnabled && providers?.length !== 0;
	// A complete book has nothing to regenerate: the job skips current units.
	// While a job is pending the only action is to cancel it.
	const action =
		active || !runnable
			? null
			: view.status === "not_started"
				? "Start preprocessing"
				: view.status === "complete"
					? null
					: view.status === "stale"
						? "Regenerate"
						: view.status === "cancelled"
							? "Resume"
							: "Retry";
	const runModel = replyModelLabel(view.provider, view.model);
	const fallback = view.preprocessDefault.available
		? view.preprocessDefault.selection
		: null;
	// A run needs a model: the default, or one chosen here.
	const startable = choice ? choice.model.trim() !== "" : fallback !== null;
	return (
		<section className="mt-8" aria-labelledby="preprocess">
			<h2 id="preprocess" className="font-medium">
				Preprocessing
			</h2>
			<div className="mt-2 max-w-xl space-y-2 rounded-md border p-3 text-sm">
				<div className="flex items-center gap-2">
					<Badge variant={failed ? "destructive" : "secondary"}>
						{LABELS[view.status]}
					</Badge>
					{view.status !== "not_started" && (
						<span>
							{view.doneUnits} of {view.totalUnits} sections
						</span>
					)}
				</div>
				{runModel && (
					<p data-testid="preprocess-run-model">
						{active ? "Model" : "Last run"}: {runModel}
					</p>
				)}
				{view.hasSpend && (
					<p>
						Spend:{" "}
						{view.spendUsd === null
							? "unknown"
							: `$${view.spendUsd.toFixed(4)}`}{" "}
						(estimate)
					</p>
				)}
				{view.hasSpend && (
					<p>
						Tokens: {tokens(view.inputTokens)} in · {tokens(view.outputTokens)}{" "}
						out
					</p>
				)}
				{view.failedUnits > 0 && (
					<p className="text-destructive-foreground">
						{view.failedUnits} sections failed.
					</p>
				)}
				{view.lastError && (
					<p className="text-destructive-foreground">{view.lastError}</p>
				)}
				{active && (
					<>
						{error && (
							<p role="alert" className="text-destructive-foreground">
								{error}
							</p>
						)}
						<p className="text-muted-foreground">
							Sections already finished are kept if you cancel.
						</p>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={onCancel}
						>
							Cancel preprocessing
						</Button>
					</>
				)}
				{!active && !runnable && view.status !== "complete" && (
					<p className="text-muted-foreground">
						No AI provider is configured. Add one in{" "}
						<Link to="/settings" className="underline underline-offset-2">
							Settings
						</Link>{" "}
						to run preprocessing again.
					</p>
				)}
				{action && (
					<>
						<p className="text-muted-foreground">
							Preprocessing sends the whole book text to your AI provider, and
							it can cost real money on long books.
						</p>
						<div className="space-y-1" data-testid="preprocess-model">
							<p className="font-medium">Model for this run</p>
							{providers ? (
								<ModelChoice
									providers={providers}
									fallback={fallback}
									value={choice}
									onChange={(next) => onChoiceChange?.(next)}
									disabled={busy}
								/>
							) : (
								fallback && <p>{selectionLabel(fallback)} (default)</p>
							)}
							{choice === null && !fallback && (
								<p className="text-muted-foreground">
									{view.preprocessDefault.selection
										? `The default, ${selectionLabel(view.preprocessDefault.selection)}, is unavailable because its provider has no credentials.`
										: "No preprocessing default is set."}{" "}
									Choose a model for this run, or set a default in{" "}
									<Link to="/settings" className="underline underline-offset-2">
										Settings
									</Link>
									.
								</p>
							)}
						</div>
						{error && (
							<p role="alert" className="text-destructive-foreground">
								{error}
							</p>
						)}
						<Button
							type="button"
							size="sm"
							disabled={busy || !startable}
							onClick={onStart}
						>
							{action}
						</Button>
					</>
				)}
			</div>
		</section>
	);
}

export function PreprocessCard({ editionId }: { editionId: string }) {
	const queryClient = useQueryClient();
	const load = useServerFn(getPreprocessStatusFn);
	const start = useServerFn(startPreprocessFn);
	const cancel = useServerFn(cancelPreprocessFn);
	const loadStatus = useServerFn(getAiStatusFn);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// This run's model only; the default is left unchanged.
	const [choice, setChoice] = useState<AiSelection | null>(null);
	const key = ["preprocess", editionId];
	const aiStatus = useQuery({
		queryKey: ["ai-status"],
		queryFn: () => loadStatus(),
	});
	const { data } = useQuery({
		queryKey: key,
		queryFn: () => load({ data: { editionId } }),
		refetchInterval: (q) =>
			q.state.data && isActive(q.state.data.status) ? 3000 : false,
	});
	if (!data) return null;
	const act = async (run: () => Promise<unknown>, failure: string) => {
		setBusy(true);
		setError(null);
		try {
			await run();
			await queryClient.invalidateQueries({ queryKey: key });
		} catch {
			setError(failure);
		} finally {
			setBusy(false);
		}
	};
	return (
		<PreprocessCardView
			view={data}
			providers={aiStatus.data?.providers}
			choice={choice}
			onChoiceChange={setChoice}
			busy={busy}
			error={error}
			onStart={() =>
				act(async () => {
					await start({
						data: { editionId, ...(choice && { selection: choice }) },
					});
					setChoice(null);
				}, "Preprocessing could not be started.")
			}
			onCancel={() =>
				act(
					() => cancel({ data: { editionId } }),
					"Preprocessing could not be cancelled.",
				)
			}
		/>
	);
}
