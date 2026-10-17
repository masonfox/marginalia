// Reader corrections of generated summaries and observations: the shared
// correction dialog and the marks a corrected item carries. Independent of
// the Guide's routes and context, so other views (the research trail) can
// offer the same flow.
import { useServerFn } from "@tanstack/react-start";
import { RotateCcw, TriangleAlert, UserPen } from "lucide-react";
import { useId, useState } from "react";
import { passageLocator } from "#/components/guide-subjects";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import {
	keepCorrectionFn,
	removeCorrectionFn,
	saveCorrectionFn,
} from "#/fns/guide";
import type { DerivedCitation } from "#/modules/analysis";
import type { CorrectionResult } from "#/modules/guide";

/** Mirrors the server's limits (MAX_CORRECTION_TEXT, MAX_CITATION_QUOTE). */
const MAX_TEXT = 10_000;
const MAX_QUOTE = 1_000;

/** A summary or observation the reader can correct, as a view shows it. */
export interface CorrectableItem {
	editionId: string;
	/** The unit's anchor: the locator of its first passage. */
	unitLocator: string;
	unitLabel: string;
	/** An observation names its name key (and the name shown); a summary neither. */
	observation: { nameKey: string; name: string } | null;
	/** The current generated text the correction covers. */
	generated: string;
	/** The reader's correction already applied, or null. */
	correction: {
		id: number;
		action: "replace" | "suppress";
		/** The reader's text and citation, for a replacement. */
		text: string | null;
		citation: DerivedCitation | null;
	} | null;
}

const SAVE_ERRORS: Record<
	Extract<CorrectionResult, { ok: false }>["reason"],
	string
> = {
	not_found:
		"This chapter is no longer part of the book's current structure. Reload and try again.",
	not_current:
		"This item has no current generated text to correct. It may be waiting to be regenerated.",
	citation_outside_unit:
		"The citation must be a passage of this chapter. Paste a passage link from it.",
	invalid: "Please write the corrected text, and keep the quote short.",
};

/**
 * Corrects a generated summary or observation: replace its text (with an
 * optional citation from the same chapter) or hide it as wrong. An existing
 * correction can be edited or removed, which restores the generated text.
 * `onChanged` runs after any saved change, so the caller can refresh.
 */
export function CorrectionDialog({
	open,
	onOpenChange,
	item,
	onChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	item: CorrectableItem;
	onChanged?: () => void | Promise<void>;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="correction-dialog">
				{open && (
					<CorrectionForm
						item={item}
						onDone={async () => {
							await onChanged?.();
							onOpenChange(false);
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function CorrectionForm({
	item,
	onDone,
}: {
	item: CorrectableItem;
	onDone: () => Promise<void>;
}) {
	const id = useId();
	const save = useServerFn(saveCorrectionFn);
	const remove = useServerFn(removeCorrectionFn);
	const existing = item.correction;
	const [action, setAction] = useState<"replace" | "suppress">(
		existing?.action ?? "replace",
	);
	const [text, setText] = useState(existing?.text ?? item.generated);
	const [passage, setPassage] = useState(existing?.citation?.locator ?? "");
	const [quote, setQuote] = useState(existing?.citation?.quote ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const locator = passageLocator(passage);
	const what = item.observation
		? `“${item.observation.name}” in ${item.unitLabel}`
		: `the summary of ${item.unitLabel}`;

	const run = async (change: () => Promise<string | null>) => {
		setBusy(true);
		setError(null);
		try {
			const failure = await change();
			if (failure) setError(failure);
			else await onDone();
		} catch {
			setError("Could not save the correction. Please try again.");
		} finally {
			setBusy(false);
		}
	};
	const submit = () =>
		run(async () => {
			if (action === "replace" && !text.trim())
				return "Please write the corrected text.";
			if (action === "replace" && (locator === null) !== !quote.trim())
				return "A citation needs both a passage and a quote from it.";
			const target = item.observation
				? { target: "observation" as const, nameKey: item.observation.nameKey }
				: { target: "summary" as const };
			const result = await save({
				data: {
					editionId: item.editionId,
					unitLocator: item.unitLocator,
					...target,
					...(action === "replace"
						? {
								action,
								text: text.trim(),
								citation: locator ? { locator, quote: quote.trim() } : null,
							}
						: { action }),
				},
			});
			return result.ok ? null : SAVE_ERRORS[result.reason];
		});
	const restore = () =>
		run(async () => {
			if (!existing) return null;
			await remove({ data: { editionId: item.editionId, id: existing.id } });
			return null;
		});

	return (
		<>
			<DialogHeader>
				<DialogTitle>Correct {what}</DialogTitle>
				<DialogDescription>
					Your correction is shown instead of the generated text, marked as
					corrected by you. The generated text is kept: remove the correction to
					bring it back.
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4 text-sm">
				<fieldset className="grid gap-2">
					<legend className="mb-1 font-medium">Correction</legend>
					<label className="flex items-start gap-2">
						<input
							type="radio"
							name={`${id}-action`}
							className="mt-1"
							checked={action === "replace"}
							onChange={() => setAction("replace")}
						/>
						<span>Replace the text</span>
					</label>
					<label className="flex items-start gap-2">
						<input
							type="radio"
							name={`${id}-action`}
							className="mt-1"
							checked={action === "suppress"}
							onChange={() => setAction("suppress")}
						/>
						<span>
							Hide it as wrong{" "}
							<span className="text-muted-foreground">
								(it stays listed under “show hidden”)
							</span>
						</span>
					</label>
				</fieldset>
				{action === "replace" ? (
					<>
						<label className="grid gap-1" htmlFor={`${id}-text`}>
							<span className="font-medium">Corrected text</span>
							<textarea
								id={`${id}-text`}
								value={text}
								maxLength={MAX_TEXT}
								rows={5}
								onChange={(e) => setText(e.currentTarget.value)}
								className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								data-testid="correction-text"
							/>
						</label>
						<fieldset className="grid gap-2">
							<legend className="mb-1 font-medium">
								Citation{" "}
								<span className="font-normal text-muted-foreground">
									(optional, from {item.unitLabel})
								</span>
							</legend>
							<Input
								aria-label="Cited passage"
								value={passage}
								onChange={(e) => setPassage(e.currentTarget.value)}
								placeholder="Paste a passage link from the reader"
								data-testid="correction-passage"
							/>
							<textarea
								aria-label="Exact quote from the passage"
								value={quote}
								maxLength={MAX_QUOTE}
								rows={2}
								onChange={(e) => setQuote(e.currentTarget.value)}
								placeholder="The exact words you are citing"
								className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								data-testid="correction-quote"
							/>
							<span className="text-xs text-muted-foreground">
								The quote is checked against the book's text and shown as
								unverified when it can't be found.
							</span>
						</fieldset>
					</>
				) : (
					<p className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
						{item.generated}
					</p>
				)}
				{error && (
					<p role="alert" className="text-sm text-destructive-foreground">
						{error}
					</p>
				)}
			</div>
			<DialogFooter className="gap-2 sm:justify-between">
				{existing ? (
					<Button
						variant="outline"
						onClick={restore}
						disabled={busy}
						data-testid="correction-remove"
					>
						<RotateCcw aria-hidden />
						Remove correction
					</Button>
				) : (
					<span />
				)}
				<div className="flex gap-2">
					<DialogClose asChild>
						<Button variant="outline" disabled={busy}>
							Cancel
						</Button>
					</DialogClose>
					<Button
						onClick={submit}
						disabled={busy}
						data-testid="correction-save"
					>
						{busy ? "Saving…" : "Save correction"}
					</Button>
				</div>
			</DialogFooter>
		</>
	);
}

/** Marks an item the reader corrected. */
export function CorrectedBadge() {
	return (
		<Badge
			variant="outline"
			title="You replaced the generated text."
			data-testid="corrected-badge"
		>
			<UserPen aria-hidden />
			Corrected by reader
		</Badge>
	);
}

/**
 * Shown on a correction whose generated text was regenerated since: the
 * new generated text, and keeping the correction (which acknowledges it) or
 * dropping it (which restores it).
 */
export function RegeneratedNotice({
	editionId,
	correctionId,
	generated,
	onChanged,
}: {
	editionId: string;
	correctionId: number;
	generated: string;
	onChanged?: () => void | Promise<void>;
}) {
	const keep = useServerFn(keepCorrectionFn);
	const remove = useServerFn(removeCorrectionFn);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const act = async (change: () => Promise<boolean>) => {
		setBusy(true);
		setError(null);
		try {
			if (await change()) await onChanged?.();
			else setError("Could not update the correction. Please reload.");
		} catch {
			setError("Could not update the correction. Please try again.");
		} finally {
			setBusy(false);
		}
	};
	const data = { editionId, id: correctionId };
	return (
		<div
			className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
			data-testid="regenerated-notice"
		>
			<p className="flex gap-2 font-medium">
				<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
				Regenerated since your correction
			</p>
			<p className="mt-1 text-muted-foreground">
				The generated text now reads: {generated}
			</p>
			<div className="mt-2 flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() => act(async () => (await keep({ data })).ok)}
				>
					Keep my correction
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() =>
						act(async () => {
							await remove({ data });
							return true;
						})
					}
				>
					Use the generated text
				</Button>
			</div>
			{error && (
				<p role="alert" className="mt-2 text-destructive-foreground">
					{error}
				</p>
			)}
		</div>
	);
}
