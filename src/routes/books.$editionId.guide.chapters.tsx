import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import {
	boundKey,
	GuideCitations,
	GuideEmpty,
	GuideError,
	useGuide,
} from "#/components/guide";
import {
	CorrectionControls,
	ShowHiddenToggle,
} from "#/components/guide-corrections";
import { AddNoteLink, AttachedNotes } from "#/components/guide-notes";
import { getGuideChaptersFn } from "#/fns/guide";

export const Route = createFileRoute("/books/$editionId/guide/chapters")({
	component: ChaptersView,
});

/**
 * Unit summaries within the bound, latest first: the last unit the reader's
 * position covers leads, back to the first. The query keeps reading order;
 * only this view reverses it.
 */
function ChaptersView() {
	const { editionId, bound, preprocessed, onStaleBound, units } = useGuide();
	const [showHidden, setShowHidden] = useState(false);
	const key = bound ? boundKey(bound) : null;
	const chapters = useQuery({
		queryKey: ["guide", editionId, "chapters", key],
		queryFn: () =>
			getGuideChaptersFn({
				data: { editionId, bound: bound?.choice ?? { kind: "whole" } },
			}),
		enabled: preprocessed && bound !== null,
	});
	const stale =
		chapters.data?.ok === false && chapters.data.reason === "stale_bound";
	useEffect(() => {
		if (stale) onStaleBound();
	}, [stale, onStaleBound]);

	if (!preprocessed) return <GuideEmpty />;
	if (chapters.isPending)
		return <p className="text-sm text-muted-foreground">Loading chapters…</p>;
	if (chapters.isError || !chapters.data.ok)
		return <GuideError>Could not load the chapters.</GuideError>;
	const list = [...chapters.data.chapters].reverse();
	const hiddenCount = list.filter(
		(c) => c.summary?.correction?.action === "suppress",
	).length;
	return (
		<section aria-label="Chapters">
			<div className="mb-4 flex flex-wrap items-start justify-end gap-2">
				<ShowHiddenToggle
					count={hiddenCount}
					shown={showHidden}
					onChange={setShowHidden}
				/>
			</div>
			{list.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No chapters end within this bound yet.
				</p>
			) : (
				<ol className="divide-y border-y">
					{list.map((chapter) => (
						<li
							key={chapter.ordinal}
							data-testid="guide-chapter"
							className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-7 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-5"
						>
							<span
								aria-hidden
								className="font-serif text-4xl leading-none text-faint-foreground"
							>
								{chapter.ordinal + 1}
							</span>
							<div className="min-w-0">
								<h2 className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.015em]">
									<Link
										to="/p/$locator"
										params={{ locator: chapter.locator }}
										className="hover:underline"
									>
										{chapter.label}
									</Link>
								</h2>
								{chapter.summary?.correction?.action === "suppress" &&
								!showHidden ? (
									<p className="mt-1 text-sm text-muted-foreground italic">
										Summary hidden by you.
									</p>
								) : chapter.summary ? (
									<CorrectionControls
										item={{
											unitLocator: chapter.locator,
											unitLabel: chapter.label,
											observation: null,
											text: chapter.summary.text,
											citation: chapter.summary.citations[0] ?? null,
										}}
										mark={chapter.summary.correction}
									>
										<p className="mt-3 max-w-prose font-reading text-[19px] leading-[1.7]">
											{chapter.summary.text}
										</p>
										<GuideCitations citations={chapter.summary.citations} />
									</CorrectionControls>
								) : (
									<p className="mt-1 text-sm text-muted-foreground italic">
										Not yet summarized.
									</p>
								)}
								<AttachedNotes notes={chapter.notes} editionId={editionId} />
								<AddNoteLink
									editionId={editionId}
									search={{ unit: chapter.locator }}
								/>
							</div>
						</li>
					))}
				</ol>
			)}
			{bound?.choice.kind === "unit" &&
				units?.some(
					(unit) =>
						unit.endPosition >
						(bound.choice.kind === "unit"
							? bound.choice.endPosition
							: Infinity),
				) && (
					<div className="flex items-center gap-4 border-b py-6 text-sm text-muted-foreground">
						<LockKeyhole className="size-5 shrink-0" aria-hidden />
						<p>Sections past this bound are hidden.</p>
					</div>
				)}
		</section>
	);
}
