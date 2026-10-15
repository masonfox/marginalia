import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	boundKey,
	GuideCitations,
	GuideEmpty,
	GuideError,
	KIND_LABELS,
	useGuide,
} from "#/components/guide";
import {
	CorrectionControls,
	ShowHiddenToggle,
} from "#/components/guide-corrections";
import { SubjectEditor } from "#/components/guide-subjects";
import { scopeText } from "#/components/scope";
import { Badge } from "#/components/ui/badge";
import { getGuideSubjectFn } from "#/fns/guide";

export const Route = createFileRoute(
	"/books/$editionId_/guide/index/$subjectRef",
)({ component: SubjectView });

/** A subject's observations within the bound, in reading order. */
function SubjectView() {
	const { subjectRef } = Route.useParams();
	const { editionId, bound, preprocessed, onStaleBound } = useGuide();
	const navigate = useNavigate();
	const [showHidden, setShowHidden] = useState(false);
	const subject = useQuery({
		queryKey: [
			"guide",
			editionId,
			"subject",
			subjectRef,
			bound ? boundKey(bound) : null,
		],
		queryFn: () =>
			getGuideSubjectFn({
				data: {
					editionId,
					bound: bound?.choice ?? { kind: "whole" },
					subjectRef,
				},
			}),
		enabled: preprocessed && bound !== null,
	});
	const stale =
		subject.data?.ok === false && subject.data.reason === "stale_bound";
	useEffect(() => {
		if (stale) onStaleBound();
	}, [stale, onStaleBound]);

	const back = (
		<p className="text-sm">
			<Link
				to="/books/$editionId/guide/index"
				params={{ editionId }}
				className="text-muted-foreground hover:underline"
			>
				← Index
			</Link>
		</p>
	);
	if (!preprocessed) return <GuideEmpty editionId={editionId} />;
	if (subject.isPending)
		return <p className="text-sm text-muted-foreground">Loading…</p>;
	if (subject.isError || !subject.data.ok)
		return <GuideError>Could not load this subject.</GuideError>;
	const timeline = subject.data.subject;
	if (!timeline) {
		return (
			<section>
				{back}
				<p className="mt-4 text-sm text-muted-foreground">
					Nothing about this subject is in the Guide{" "}
					{bound?.label ? `through ${bound.label}` : "for this book"}.
				</p>
			</section>
		);
	}
	const hiddenCount = timeline.entries.filter(
		(e) => e.correction?.action === "suppress",
	).length;
	const entries = showHidden
		? timeline.entries
		: timeline.entries.filter((e) => e.correction?.action !== "suppress");
	const visibleCount = timeline.entries.length - hiddenCount;
	return (
		<section aria-labelledby="guide-subject">
			{back}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<h2 id="guide-subject" className="font-serif text-2xl font-semibold">
					{timeline.name}
				</h2>
				<Badge variant="secondary">{KIND_LABELS[timeline.kind].singular}</Badge>
			</div>
			<p className="mt-1 text-xs text-muted-foreground">
				{scopeText(bound?.label ?? null)} · {visibleCount} observation
				{visibleCount === 1 ? "" : "s"}
				{timeline.names.length > 1 &&
					` · also ${timeline.names
						.filter((n) => n.name !== timeline.name)
						.map((n) => `“${n.name}”`)
						.join(", ")}`}
			</p>
			<SubjectEditor
				subject={timeline}
				onRefChange={(ref) =>
					void navigate({
						to: "/books/$editionId/guide/index/$subjectRef",
						params: { editionId, subjectRef: ref },
						replace: true,
					})
				}
			/>
			<div className="mt-4 flex flex-wrap items-center gap-2">
				<ShowHiddenToggle
					count={hiddenCount}
					shown={showHidden}
					onChange={setShowHidden}
				/>
				{entries.length === 0 && (
					<p className="text-sm text-muted-foreground">
						You hid every observation of this subject.
					</p>
				)}
			</div>
			<ol className="mt-4 space-y-5 border-l pl-4">
				{entries.map((entry, i) => (
					<li
						// One subject has at most a few observations per unit, in a fixed order.
						// biome-ignore lint/suspicious/noArrayIndexKey: entries are a fixed list
						key={i}
						data-testid="guide-timeline-entry"
					>
						<h3 className="text-sm font-medium">
							<Link
								to="/p/$locator"
								params={{ locator: entry.unitLocator }}
								className="hover:underline"
							>
								{entry.unitLabel}
							</Link>
							{entry.observedAs && (
								<span className="font-normal text-muted-foreground">
									{" "}
									· as “{entry.observedAs}”
								</span>
							)}
						</h3>
						<CorrectionControls
							item={{
								unitLocator: entry.unitLocator,
								unitLabel: entry.unitLabel,
								observation: {
									nameKey: entry.nameKey,
									name: entry.observedAs ?? timeline.name,
								},
								text: entry.note,
								citation: entry.citations[0] ?? null,
							}}
							mark={entry.correction}
						>
							<p className="mt-1 max-w-prose text-sm leading-relaxed">
								{entry.note}
							</p>
							<GuideCitations citations={entry.citations} />
						</CorrectionControls>
					</li>
				))}
			</ol>
		</section>
	);
}
