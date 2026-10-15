import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { getPreprocessStatusFn, startPreprocessFn } from "#/fns/preprocess";

export interface PreprocessView {
	status:
		| "not_started"
		| "queued"
		| "running"
		| "complete"
		| "partial"
		| "stale";
	totalUnits: number;
	doneUnits: number;
	failedUnits: number;
	model: string | null;
	lastError: string | null;
	aiEnabled: boolean;
	configuredModel: string | null;
	spendUsd: number | null;
	hasSpend: boolean;
}

export const isActive = (s: PreprocessView["status"]) =>
	s === "queued" || s === "running";

const LABELS: Record<PreprocessView["status"], string> = {
	not_started: "Not started",
	queued: "Queued",
	running: "Running",
	complete: "Complete",
	partial: "Incomplete",
	stale: "Out of date",
};

/** Presentational card; the container below wires data and actions. */
export function PreprocessCardView({
	view,
	busy = false,
	error = null,
	onStart,
}: {
	view: PreprocessView;
	busy?: boolean;
	error?: string | null;
	onStart?: () => void;
}) {
	// Without AI there is no preprocessing status or action to show.
	if (!view.aiEnabled) return null;
	const active = isActive(view.status);
	const failed = view.failedUnits > 0 || view.lastError !== null;
	// A complete book has nothing to regenerate: the job skips current units.
	const action =
		view.status === "not_started"
			? "Start preprocessing"
			: view.status === "complete"
				? null
				: view.status === "stale"
					? "Regenerate"
					: "Retry";
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
				{view.model && <p>Model: {view.model}</p>}
				{view.hasSpend && (
					<p>
						Spend:{" "}
						{view.spendUsd === null
							? "unknown"
							: `$${view.spendUsd.toFixed(4)}`}{" "}
						(estimate)
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
				{action && (
					<>
						<p className="text-muted-foreground">
							Preprocessing sends the whole book text to your AI provider, and
							it can cost real money on long books.
						</p>
						{error && (
							<p role="alert" className="text-destructive-foreground">
								{error}
							</p>
						)}
						<Button
							type="button"
							size="sm"
							disabled={active || busy}
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
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const key = ["preprocess", editionId];
	const { data } = useQuery({
		queryKey: key,
		queryFn: () => load({ data: { editionId } }),
		refetchInterval: (q) =>
			q.state.data && isActive(q.state.data.status) ? 3000 : false,
	});
	if (!data) return null;
	return (
		<PreprocessCardView
			view={data}
			busy={busy}
			error={error}
			onStart={async () => {
				setBusy(true);
				setError(null);
				try {
					await start({ data: { editionId } });
					await queryClient.invalidateQueries({ queryKey: key });
				} catch {
					setError("Preprocessing could not be started.");
				} finally {
					setBusy(false);
				}
			}}
		/>
	);
}
