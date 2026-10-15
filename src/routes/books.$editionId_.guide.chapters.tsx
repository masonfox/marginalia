import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import {
	boundKey,
	GuideCitations,
	GuideEmpty,
	GuideError,
	provenanceText,
	useGuide,
} from "#/components/guide";
import { getGuideChaptersFn, getGuideProvenanceFn } from "#/fns/guide";

export const Route = createFileRoute("/books/$editionId_/guide/chapters")({
	component: ChaptersView,
});

/** Unit summaries within the bound, in reading order. */
function ChaptersView() {
	const { editionId, bound, preprocessed, onStaleBound } = useGuide();
	const key = bound ? boundKey(bound) : null;
	const chapters = useQuery({
		queryKey: ["guide", editionId, "chapters", key],
		queryFn: () =>
			getGuideChaptersFn({
				data: { editionId, bound: bound?.choice ?? { kind: "whole" } },
			}),
		enabled: preprocessed && bound !== null,
	});
	const provenance = useQuery({
		queryKey: ["guide", editionId, "provenance", key],
		queryFn: () =>
			getGuideProvenanceFn({
				data: { editionId, bound: bound?.choice ?? { kind: "whole" } },
			}),
		enabled: preprocessed && bound !== null,
	});
	const stale =
		(chapters.data?.ok === false && chapters.data.reason === "stale_bound") ||
		(provenance.data?.ok === false && provenance.data.reason === "stale_bound");
	useEffect(() => {
		if (stale) onStaleBound();
	}, [stale, onStaleBound]);

	if (!preprocessed) return <GuideEmpty editionId={editionId} />;
	if (chapters.isPending)
		return <p className="text-sm text-muted-foreground">Loading chapters…</p>;
	if (chapters.isError || !chapters.data.ok)
		return <GuideError>Could not load the chapters.</GuideError>;
	const list = chapters.data.chapters;
	return (
		<section aria-label="Chapters">
			{provenance.data?.ok && (
				<p
					className="mb-4 text-xs text-muted-foreground"
					data-testid="guide-provenance"
				>
					{provenanceText(provenance.data.provenance)}. Summaries are a guide,
					not the text.
				</p>
			)}
			{list.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No chapters end within this bound yet.
				</p>
			) : (
				<ol className="space-y-6">
					{list.map((chapter) => (
						<li key={chapter.ordinal} data-testid="guide-chapter">
							<h2 className="font-medium">
								<Link
									to="/p/$locator"
									params={{ locator: chapter.locator }}
									className="hover:underline"
								>
									{chapter.label}
								</Link>
							</h2>
							{chapter.summary ? (
								<>
									<p className="mt-1 max-w-prose text-sm leading-relaxed">
										{chapter.summary.text}
									</p>
									<GuideCitations citations={chapter.summary.citations} />
								</>
							) : (
								<p className="mt-1 text-sm text-muted-foreground italic">
									Not yet summarized.
								</p>
							)}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
