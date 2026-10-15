import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
	type Choice,
	positionChoice,
	ScopeChoices,
	STALE,
	toScope,
} from "#/components/scope";
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
import { getReadingUnitsFn } from "#/fns/conversations";
import {
	clearReadingPositionFn,
	getReadingPositionFn,
	setReadingPositionFn,
} from "#/fns/guide";
import type { ReadingPosition } from "#/modules/guide";

/** "Not set", "Finished", or the unit's label. */
export const positionText = (position: ReadingPosition | null) =>
	position === null
		? "Not set"
		: position.kind === "finished"
			? "Finished"
			: position.scopeLabel;

/** Whether choosing `choice` moves the position earlier, which needs confirmation. */
export function isMoveBack(
	position: ReadingPosition | null,
	choice: Choice,
): boolean {
	if (position === null || choice === "whole") return false;
	if (position.kind === "finished") return true;
	return Number(choice.slice(5)) < position.maxPosition;
}

const SHARED =
	"Your reading position is shared by everyone using this Marginalia instance.";

/**
 * The book's reading position with controls to set, advance, move back
 * (after confirmation), or clear it.
 */
export function ReadingPositionCard({ editionId }: { editionId: string }) {
	const queryClient = useQueryClient();
	const set = useServerFn(setReadingPositionFn);
	const clear = useServerFn(clearReadingPositionFn);
	const [open, setOpen] = useState(false);
	const [choice, setChoice] = useState<Choice | null>(null);
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const position = useQuery({
		queryKey: ["reading-position", editionId],
		queryFn: () => getReadingPositionFn({ data: { editionId } }),
	});
	const units = useQuery({
		queryKey: ["reading-units", editionId],
		queryFn: () => getReadingUnitsFn({ data: { editionId } }),
		enabled: open,
	});
	const current = position.data ?? null;
	const label = (c: Choice) =>
		c === "whole"
			? "Finished"
			: (units.data?.find((u) => `unit:${u.endPosition}` === c)?.label ??
				"the chosen chapter");
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: ["reading-position", editionId],
		});

	const save = async (c: Choice, moveBack: boolean) => {
		setBusy(true);
		setError(null);
		try {
			const result = await set({
				data: { editionId, choice: toScope(c), moveBack },
			});
			if (result.set) {
				setConfirming(false);
				setOpen(false);
				setChoice(null);
			} else if (result.reason === "move_back") {
				// Advanced elsewhere since this page loaded: confirm against the new position.
				setConfirming(true);
			} else if (result.reason === "stale_scope") {
				setConfirming(false);
				setChoice(null);
				setError(STALE);
				await units.refetch();
			} else {
				setConfirming(false);
				setError("This book is not ready.");
			}
			await refresh();
		} catch {
			setConfirming(false);
			setError("Could not save your reading position. Please try again.");
		}
		setBusy(false);
	};

	return (
		<section className="mt-8" aria-labelledby="reading-position">
			<h2 id="reading-position" className="font-medium">
				Reading position
			</h2>
			<div className="mt-2 max-w-xl space-y-2 rounded-md border p-3 text-sm">
				<p data-testid="reading-position-value">
					{position.isPending
						? "Loading…"
						: position.isError
							? "Could not load your reading position."
							: positionText(current)}
				</p>
				<p className="text-muted-foreground">{SHARED}</p>
				<div className="flex flex-wrap gap-2">
					<Dialog
						open={open}
						onOpenChange={(next) => {
							if (busy) return;
							setOpen(next);
							setChoice(null);
							setError(null);
						}}
					>
						<DialogTrigger asChild>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={position.isPending}
							>
								{current === null ? "Set position" : "Change position"}
							</Button>
						</DialogTrigger>
						<DialogContent data-testid="reading-position-dialog">
							<DialogHeader>
								<DialogTitle>How far have you read?</DialogTitle>
								<DialogDescription>
									Choose the last chapter you finished, or the whole book.
									Conversations keep their own scope. {SHARED}
								</DialogDescription>
							</DialogHeader>
							{units.isPending ? (
								<p className="text-sm text-muted-foreground">
									Loading chapters…
								</p>
							) : units.isError ? (
								<p className="text-sm text-destructive-foreground">
									Could not load this book's chapters.
								</p>
							) : (
								<ScopeChoices
									units={units.data}
									value={choice}
									position={positionChoice(current, units.data)}
									legend="Your reading position"
									onChange={(c) => {
										setChoice(c);
										setError(null);
									}}
								/>
							)}
							{error && (
								<p role="alert" className="text-sm text-destructive-foreground">
									{error}
								</p>
							)}
							<DialogFooter>
								<DialogClose asChild>
									<Button type="button" variant="outline" disabled={busy}>
										Cancel
									</Button>
								</DialogClose>
								<Button
									type="button"
									disabled={choice === null || busy}
									onClick={() => {
										if (choice === null) return;
										if (isMoveBack(current, choice)) setConfirming(true);
										else void save(choice, false);
									}}
								>
									Save
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
					{current !== null && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={async () => {
								setBusy(true);
								setError(null);
								try {
									await clear({ data: { editionId } });
									await refresh();
								} catch {
									setError("Could not clear your reading position.");
								}
								setBusy(false);
							}}
						>
							Clear
						</Button>
					)}
				</div>
				{error && !open && (
					<p role="alert" className="text-destructive-foreground">
						{error}
					</p>
				)}
			</div>
			<AlertDialog
				open={confirming}
				onOpenChange={(next) => {
					if (!busy) setConfirming(next);
				}}
			>
				<AlertDialogContent data-testid="move-back-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>
							Move your reading position back?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Your position moves from {positionText(current)} back to{" "}
							{choice === null ? "an earlier chapter" : label(choice)}, for
							example for a re-read.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busy}>
							Keep my position
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={busy || choice === null}
							onClick={(event) => {
								// Keep the dialog open until the move finishes.
								event.preventDefault();
								if (choice !== null) void save(choice, true);
							}}
						>
							Move back
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
