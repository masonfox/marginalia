import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
	boundKey,
	GuideEmpty,
	GuideError,
	KIND_LABELS,
	KINDS,
	useGuide,
} from "#/components/guide";
import { ShowHiddenToggle } from "#/components/guide-corrections";
import { ProposalList } from "#/components/guide-subjects";
import { Badge } from "#/components/ui/badge";
import { Input } from "#/components/ui/input";
import { listGuideSubjectsFn } from "#/fns/guide";

export const Route = createFileRoute("/books/$editionId_/guide/index/")({
	validateSearch: z.object({
		kind: z.enum(["character", "place", "object", "motif"]).optional(),
		q: z.string().max(200).optional(),
	}),
	component: IndexView,
});

/** Subjects observed within the bound, filterable by kind and name. */
function IndexView() {
	const { editionId, bound, preprocessed, onStaleBound } = useGuide();
	const { kind, q } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [showHidden, setShowHidden] = useState(false);
	// Hidden subjects are always fetched, so the toggle can count them.
	const subjects = useQuery({
		queryKey: [
			"guide",
			editionId,
			"subjects",
			bound ? boundKey(bound) : null,
			"with-hidden",
		],
		queryFn: () =>
			listGuideSubjectsFn({
				data: {
					editionId,
					bound: bound?.choice ?? { kind: "whole" },
					includeHidden: true,
				},
			}),
		enabled: preprocessed && bound !== null,
	});
	const stale =
		subjects.data?.ok === false && subjects.data.reason === "stale_bound";
	useEffect(() => {
		if (stale) onStaleBound();
	}, [stale, onStaleBound]);

	if (!preprocessed) return <GuideEmpty editionId={editionId} />;
	const text = q?.trim().toLocaleLowerCase() ?? "";
	const withHidden = subjects.data?.ok ? subjects.data.subjects : [];
	const hiddenCount = withHidden.filter((s) => s.hidden).length;
	const all = showHidden ? withHidden : withHidden.filter((s) => !s.hidden);
	const shown = all.filter(
		(s) =>
			(!kind || s.kind === kind) &&
			(!text || s.name.toLocaleLowerCase().includes(text)),
	);
	const filter = (next: { kind?: typeof kind; q?: string }) =>
		void navigate({
			search: (prev) => ({ ...prev, ...next }),
			replace: true,
		});

	return (
		<section aria-label="Index">
			<div className="flex flex-wrap items-center gap-2">
				<fieldset className="flex flex-wrap gap-1">
					<legend className="sr-only">Kind</legend>
					{([undefined, ...KINDS] as const).map((k) => (
						<button
							key={k ?? "all"}
							type="button"
							aria-pressed={kind === k}
							onClick={() => filter({ kind: k })}
							className={cn(
								"rounded-md border px-2.5 py-1 text-sm transition-colors hover:bg-accent",
								kind === k &&
									"border-primary bg-primary text-primary-foreground hover:bg-primary",
							)}
						>
							{k ? KIND_LABELS[k].plural : "All"}
						</button>
					))}
				</fieldset>
				<Input
					type="search"
					defaultValue={q}
					placeholder="Filter by name"
					aria-label="Filter by name"
					className="max-w-56"
					onChange={(e) => filter({ q: e.currentTarget.value || undefined })}
				/>
				<ShowHiddenToggle
					count={hiddenCount}
					shown={showHidden}
					onChange={setShowHidden}
				/>
			</div>
			<ProposalList />
			{subjects.isPending ? (
				<p className="mt-4 text-sm text-muted-foreground">Loading the index…</p>
			) : subjects.isError || !subjects.data.ok ? (
				<div className="mt-4">
					<GuideError>Could not load the index.</GuideError>
				</div>
			) : shown.length === 0 ? (
				<p className="mt-4 text-sm text-muted-foreground">
					{all.length === 0
						? "Nothing has been observed within this bound yet."
						: "No subjects match these filters."}
				</p>
			) : (
				<ul className="mt-4 divide-y rounded-md border">
					{shown.map((s) => (
						<li key={s.ref} data-testid="guide-subject">
							<Link
								to="/books/$editionId/guide/index/$subjectRef"
								params={{ editionId, subjectRef: s.ref }}
								className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-accent/50"
							>
								<span className="font-medium">{s.name}</span>
								<Badge variant="secondary">
									{KIND_LABELS[s.kind].singular}
								</Badge>
								{s.hidden && <Badge variant="outline">Hidden by you</Badge>}
								<span className="text-xs text-muted-foreground">
									{s.unitCount} chapter{s.unitCount === 1 ? "" : "s"} · first in{" "}
									{s.firstUnitLabel}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
