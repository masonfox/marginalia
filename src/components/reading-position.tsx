import { Link } from "@tanstack/react-router";
import { BookMarked, Bookmark, BookOpen } from "lucide-react";
import { useState } from "react";
import {
	Eyebrow,
	ScopePill,
	ProgressBar as SharedProgressBar,
} from "#/components/pieces";
import { type Choice, positionChoice, ScopeChoices } from "#/components/scope";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import {
	type SaveResult,
	useReadingPosition,
} from "#/hooks/use-reading-position";
import type { ReadingProgress } from "#/lib/reading-progress";
import type { ReadingUnit } from "#/modules/catalog";
import type { ReadingPosition } from "#/modules/guide";

export { isMoveBack } from "#/hooks/use-reading-position";

/** "Not set", "Finished", or the unit's label. */
export const positionText = (position: ReadingPosition | null) =>
	position === null
		? "Not set"
		: position.kind === "finished"
			? "Finished"
			: position.scopeLabel;

export const SHARED_POSITION =
	"Your reading position is shared by everyone using this Marginalia instance.";

/**
 * The book's reading position for the book page header, with controls to set,
 * advance, move back (after confirmation), or clear it. The full hero shows it
 * as "Your place": the unit's label, progress through the book, and a link to
 * continue reading. The compact hero shows it as a scope pill. Every instance
 * shares the query cache through `useReadingPosition`, so a save anywhere on
 * the page updates it.
 */
export function ReadingPositionControl({
	editionId,
	compact = false,
}: {
	editionId: string;
	/** The compact book hero: the position as a pill and its control, without progress. */
	compact?: boolean;
}) {
	const reading = useReadingPosition(editionId);
	const { position: current, units, busy, error } = reading;
	const [open, setOpen] = useState(false);
	const [choice, setChoice] = useState<Choice | null>(null);
	const label = (c: Choice) =>
		c === "whole"
			? "Finished"
			: (units?.find((u) => `unit:${u.endPosition}` === c)?.label ??
				"the chosen chapter");

	const after = (result: SaveResult) => {
		if (result === "saved") {
			setOpen(false);
			setChoice(null);
		} else if (result === "stale") setChoice(null);
	};

	const isSet = reading.positionStatus === "success" && current !== null;

	// Labels wrap rather than being cut, however long the chapter's name.
	const status = (
		<p className="flex min-w-0 items-start gap-2 text-muted-foreground">
			<BookMarked className="mt-0.5 size-4 shrink-0" aria-hidden />
			<span className="min-w-0 break-words">
				{reading.positionStatus === "success" && "Reading position: "}
				<span data-testid="reading-position-value">
					{reading.positionStatus === "pending"
						? "Loading…"
						: reading.positionStatus === "error"
							? "Could not load your reading position."
							: positionText(current)}
				</span>
			</span>
		</p>
	);

	const alerts = (
		<>
			{error && !open && (
				<p role="alert" className="basis-full text-destructive-foreground">
					{error}
				</p>
			)}
			<MoveBackDialog reading={reading} label={label} onSettled={after} />
		</>
	);

	const dialog = (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (busy) return;
				setOpen(next);
				setChoice(null);
				reading.dismissError();
			}}
		>
			<DialogTrigger asChild>
				<Button
					type="button"
					size={compact ? "sm" : "default"}
					variant="ghost"
					className={
						compact
							? "pointer-coarse:h-10"
							: "text-[13.5px] text-muted-foreground"
					}
					disabled={reading.positionStatus === "pending"}
				>
					{current === null ? "Set position" : "Change position"}
				</Button>
			</DialogTrigger>
			<DialogContent data-testid="reading-position-dialog">
				<DialogHeader>
					<DialogTitle>How far have you read?</DialogTitle>
					<DialogDescription>
						Choose the last chapter you finished, or the whole book.
						Conversations keep their own scope. {SHARED_POSITION}
					</DialogDescription>
				</DialogHeader>
				{reading.unitsStatus === "pending" ? (
					<p className="text-sm text-muted-foreground">Loading chapters…</p>
				) : units === undefined ? (
					<p className="text-sm text-destructive-foreground">
						Could not load this book's chapters.
					</p>
				) : (
					<ScopeChoices
						units={units}
						value={choice}
						position={positionChoice(current, units)}
						legend="Your reading position"
						onChange={(c) => {
							setChoice(c);
							reading.dismissError();
						}}
					/>
				)}
				{error && (
					<p role="alert" className="text-sm text-destructive-foreground">
						{error}
					</p>
				)}
				<DialogFooter>
					{current !== null && (
						<Button
							type="button"
							variant="ghost"
							className="sm:mr-auto"
							disabled={busy}
							onClick={() =>
								void reading.clear().then((cleared) => {
									if (!cleared) return;
									setOpen(false);
									setChoice(null);
								})
							}
						>
							Clear position
						</Button>
					)}
					<DialogClose asChild>
						<Button type="button" variant="outline" disabled={busy}>
							Cancel
						</Button>
					</DialogClose>
					<Button
						type="button"
						disabled={choice === null || busy}
						onClick={() => {
							if (choice !== null) void reading.save(choice).then(after);
						}}
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);

	if (compact)
		return (
			<section
				className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm"
				aria-label="Reading position"
				data-testid="reading-position"
			>
				{isSet ? (
					<ScopePill>
						{current.kind === "finished" ? "" : "You’re through "}
						<span className="break-words" data-testid="reading-position-value">
							{positionText(current)}
						</span>
					</ScopePill>
				) : (
					status
				)}
				<div>{dialog}</div>
				{alerts}
			</section>
		);

	const next =
		reading.positionStatus === "success" ? nextUnit(current, units) : undefined;
	return (
		<section
			className="max-w-[380px] text-sm"
			aria-label="Reading position"
			data-testid="reading-position"
		>
			{isSet ? (
				<>
					<Eyebrow className="flex items-center gap-1.5 text-amber-foreground">
						<Bookmark className="size-3" strokeWidth={2.2} aria-hidden />
						Your place
					</Eyebrow>
					<p
						className="mt-2 text-[15.5px] leading-[1.3] font-semibold break-words"
						data-testid="reading-position-value"
					>
						{positionText(current)}
					</p>
					{reading.progress && <ProgressBar progress={reading.progress} />}
				</>
			) : (
				status
			)}
			<div className="mt-4 flex flex-wrap items-center gap-1.5">
				{next && (
					<Button asChild variant="outline">
						<Link
							to="/p/$locator"
							params={{ locator: next.startLocator }}
							data-testid="continue-reading"
						>
							<BookOpen aria-hidden />
							{current === null ? "Start reading" : "Continue reading"}
						</Link>
					</Button>
				)}
				{dialog}
			</div>
			{alerts}
		</section>
	);
}

/**
 * Where reading continues: the first unit after the reading position, or the
 * first unit when it is not set. None once the book is finished, the last
 * unit is read, or the position's unit is not among the units.
 */
export function nextUnit(
	position: ReadingPosition | null,
	units: ReadingUnit[] | undefined,
): ReadingUnit | undefined {
	if (!units || units.length === 0) return undefined;
	if (position === null) return units[0];
	if (position.kind === "finished") return undefined;
	const at = units.findIndex((u) => u.endPosition === position.maxPosition);
	return at === -1 ? undefined : units[at + 1];
}

/**
 * Asks before moving the reading position back, while a save waits for
 * confirmation (`pendingMoveBack`). `onSettled` gets the confirmed save's result.
 */
export function MoveBackDialog({
	reading,
	label,
	onSettled,
}: {
	reading: ReturnType<typeof useReadingPosition>;
	/** The chosen unit's label, or "Finished". */
	label: (choice: Choice) => string;
	onSettled: (result: SaveResult) => void;
}) {
	const { position, pendingMoveBack, busy } = reading;
	return (
		<AlertDialog
			open={pendingMoveBack !== null}
			onOpenChange={(next) => {
				if (!next) reading.cancelMoveBack();
			}}
		>
			<AlertDialogContent data-testid="move-back-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>Move your reading position back?</AlertDialogTitle>
					<AlertDialogDescription>
						Your position moves from {positionText(position)} back to{" "}
						{pendingMoveBack === null
							? "an earlier chapter"
							: label(pendingMoveBack)}
						, for example for a re-read.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>
						Keep my position
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={busy || pendingMoveBack === null}
						onClick={(event) => {
							// Keep the dialog open until the move finishes.
							event.preventDefault();
							void reading.confirmMoveBack().then(onSettled);
						}}
					>
						Move back
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/**
 * A bar for the share of passages read, then which unit of how many ("13/22").
 * The fraction is visual; the bar's value text says it in words.
 */
function ProgressBar({ progress }: { progress: ReadingProgress }) {
	return (
		<div className="mt-2.5 flex items-center gap-2.5">
			<SharedProgressBar
				value={progress.share}
				label="Share of the book read"
				aria-valuetext={`${progress.index} of ${progress.count} sections`}
				className="h-[5px] min-w-0 flex-1"
				data-testid="reading-progress-bar"
			/>
			<span
				aria-hidden
				className="shrink-0 text-xs leading-none font-semibold whitespace-nowrap tabular-nums"
				data-testid="reading-progress"
			>
				<span className="text-amber-foreground">{progress.index}</span>
				<span className="text-faint-foreground">/{progress.count}</span>
			</span>
		</div>
	);
}
