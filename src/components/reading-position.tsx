import { BookMarked } from "lucide-react";
import { useState } from "react";
import {
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
 * The book's reading position for the book page header: its label, progress
 * through the book, and controls to set, advance, move back (after
 * confirmation), or clear it. Every instance shares the query cache through
 * `useReadingPosition`, so a save anywhere on the page updates it.
 */
export function ReadingPositionControl({
	editionId,
	compact = false,
}: {
	editionId: string;
	/** The compact book hero: the position and its control, without the progress bar. */
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

	return (
		<section
			className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm"
			aria-label="Reading position"
			data-testid="reading-position"
		>
			{/* The label wraps rather than being cut, however long the chapter's name. */}
			{reading.positionStatus === "success" && current !== null ? (
				<ScopePill>
					{current.kind === "finished" ? "" : "You’re through "}
					<span className="break-words" data-testid="reading-position-value">
						{positionText(current)}
					</span>
				</ScopePill>
			) : (
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
			)}
			{!compact && reading.progress && (
				<ProgressBar progress={reading.progress} />
			)}
			<div>
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
							size="sm"
							variant="ghost"
							className="pointer-coarse:h-10"
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
			</div>
			{error && !open && (
				<p role="alert" className="basis-full text-destructive-foreground">
					{error}
				</p>
			)}
			<MoveBackDialog reading={reading} label={label} onSettled={after} />
		</section>
	);
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

/** Which unit of how many, with a bar for the share of passages read. */
function ProgressBar({ progress }: { progress: ReadingProgress }) {
	return (
		<div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
			<SharedProgressBar
				value={progress.share}
				label="Share of the book read"
				className="w-28 shrink-0 sm:w-40"
				data-testid="reading-progress-bar"
			/>
			<span className="shrink-0 tabular-nums" data-testid="reading-progress">
				{progress.index} of {progress.count}
			</span>
		</div>
	);
}
