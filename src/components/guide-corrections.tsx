// The Guide's side of reader corrections: the correct action on an item,
// hidden items behind "show hidden", and the review of corrections that
// were regenerated since or detached by a reparse.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, EyeOff, PencilLine, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
	type CorrectableItem,
	CorrectedBadge,
	CorrectionDialog,
	RegeneratedNotice,
} from "#/components/corrections";
import { boundKey, useGuide } from "#/components/guide";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { getCorrectionReviewFn, removeCorrectionFn } from "#/fns/guide";
import type { DerivedCitation } from "#/modules/analysis";
import type { CorrectionMark } from "#/modules/guide";

/** Refreshes every Guide read of the edition after a correction changes. */
export function useGuideRefresh(): () => Promise<void> {
	const { editionId } = useGuide();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({ queryKey: ["guide", editionId] });
}

/** "Show hidden (N)": lists the items the reader hid. Nothing when there are none. */
export function ShowHiddenToggle({
	count,
	shown,
	onChange,
}: {
	count: number;
	shown: boolean;
	onChange: (shown: boolean) => void;
}) {
	if (count === 0) return null;
	return (
		<Button
			type="button"
			size="xs"
			variant="outline"
			aria-pressed={shown}
			onClick={() => onChange(!shown)}
			data-testid="show-hidden"
		>
			{shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
			{shown ? "Hide hidden" : `Show hidden (${count})`}
		</Button>
	);
}

/**
 * A generated item in the Guide with its correction state: the "corrected
 * by reader" mark, the regenerated-since review, and the correct action.
 * A hidden item shows its generated text only while hidden ones are shown,
 * with a restore action.
 */
export function CorrectionControls({
	item,
	mark,
	children,
}: {
	/** What the dialog corrects; `correction` is filled from `mark`. */
	item: Omit<CorrectableItem, "editionId" | "generated" | "correction"> & {
		/** The reader's text and citation, when the item shows a replacement. */
		text: string | null;
		citation: DerivedCitation | null;
	};
	mark: CorrectionMark | null;
	/** The item's text and citations as shown. */
	children: React.ReactNode;
}) {
	const { editionId } = useGuide();
	const refresh = useGuideRefresh();
	const remove = useServerFn(removeCorrectionFn);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const hidden = mark?.action === "suppress";
	const correctable: CorrectableItem = {
		editionId,
		unitLocator: item.unitLocator,
		unitLabel: item.unitLabel,
		observation: item.observation,
		// A replaced item shows the reader's text: the dialog edits against the generated one.
		generated: mark?.generated ?? item.text ?? "",
		correction: mark
			? {
					id: mark.id,
					action: mark.action,
					text: mark.action === "replace" ? item.text : null,
					citation: mark.action === "replace" ? item.citation : null,
				}
			: null,
	};
	const restore = async () => {
		if (!mark) return;
		setBusy(true);
		try {
			await remove({ data: { editionId, id: mark.id } });
			await refresh();
		} finally {
			setBusy(false);
		}
	};
	return (
		<div data-correction={mark?.action ?? "none"}>
			{hidden ? (
				<div className="mt-1 rounded-md border border-dashed p-2 text-muted-foreground">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="outline">
							<EyeOff aria-hidden />
							Hidden by you
						</Badge>
						<Button
							size="xs"
							variant="ghost"
							onClick={restore}
							disabled={busy}
							data-testid="correction-restore"
						>
							<RotateCcw aria-hidden />
							Restore
						</Button>
					</div>
					<div className="mt-1 line-through decoration-muted-foreground/50">
						{children}
					</div>
				</div>
			) : (
				children
			)}
			{mark?.regeneratedSince && (
				<RegeneratedNotice
					editionId={editionId}
					correctionId={mark.id}
					generated={mark.generated}
					onChanged={refresh}
				/>
			)}
			<div className="mt-1 flex flex-wrap items-center gap-2">
				{mark?.action === "replace" && <CorrectedBadge />}
				<Button
					size="xs"
					variant="ghost"
					className="text-muted-foreground"
					onClick={() => setOpen(true)}
					data-testid="correct-this"
				>
					<PencilLine aria-hidden />
					{mark ? "Edit correction" : "Correct this"}
				</Button>
			</div>
			<CorrectionDialog
				open={open}
				onOpenChange={setOpen}
				item={correctable}
				onChanged={refresh}
			/>
		</div>
	);
}

/**
 * The reader's corrections that need attention within the bound: those
 * whose generated text was regenerated since, to keep or drop, and those a
 * reparse detached from their chapter, which apply nowhere until dropped.
 */
export function CorrectionReviewPanel() {
	const { editionId, bound, preprocessed } = useGuide();
	const refresh = useGuideRefresh();
	const remove = useServerFn(removeCorrectionFn);
	const review = useQuery({
		queryKey: [
			"guide",
			editionId,
			"correction-review",
			bound ? boundKey(bound) : null,
		],
		queryFn: () =>
			getCorrectionReviewFn({
				data: { editionId, bound: bound?.choice ?? { kind: "whole" } },
			}),
		enabled: preprocessed && bound !== null,
	});
	if (!review.data?.ok) return null;
	const { regenerated, detached } = review.data.review;
	if (regenerated.length === 0 && detached.length === 0) return null;
	return (
		<section
			className="mb-6 space-y-3 rounded-md border p-4 text-sm"
			aria-labelledby="correction-review"
			data-testid="correction-review"
		>
			<h2 id="correction-review" className="font-medium">
				Your corrections to review
			</h2>
			{regenerated.length > 0 && (
				<ul className="space-y-3">
					{regenerated.map((c) => (
						<li key={c.id} data-testid="review-regenerated">
							<p>
								<span className="font-medium">
									{c.name ? `“${c.name}” in ${c.unitLabel}` : c.unitLabel}
								</span>
								<span className="text-muted-foreground">
									{" "}
									· {c.text ? `your text: ${c.text}` : "hidden by you"}
								</span>
							</p>
							<RegeneratedNotice
								editionId={editionId}
								correctionId={c.id}
								generated={c.generated}
								onChanged={refresh}
							/>
						</li>
					))}
				</ul>
			)}
			{detached.length > 0 && (
				<div>
					<p className="text-muted-foreground">
						The book was re-read and these chapters no longer exist as they did,
						so these corrections apply nowhere. Drop them, then correct the
						chapter again if you need to.
					</p>
					<ul className="mt-2 divide-y rounded-md border">
						{detached.map((c) => (
							<li
								key={c.id}
								className="flex flex-wrap items-center gap-2 px-3 py-2"
								data-testid="review-detached"
							>
								<span className="min-w-0 flex-1">
									{c.target === "summary"
										? "A chapter summary"
										: `An observation of “${c.nameKey}”`}
									{c.unitLabel && ` (now within ${c.unitLabel})`}
									<span className="text-muted-foreground">
										{" "}
										· {c.text ? `your text: ${c.text}` : "hidden by you"}
									</span>
								</span>
								<Button
									size="xs"
									variant="outline"
									onClick={async () => {
										await remove({ data: { editionId, id: c.id } });
										await refresh();
									}}
								>
									Drop
								</Button>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
