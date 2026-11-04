import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { type Choice, STALE, toScope } from "#/components/scope";
import { getReadingUnitsFn } from "#/fns/conversations";
import {
	clearReadingPositionFn,
	getReadingPositionFn,
	setReadingPositionFn,
} from "#/fns/guide";
import { readingProgress } from "#/lib/reading-progress";
import type { ReadingPosition } from "#/modules/guide";

/** Whether choosing `choice` moves the position earlier, which needs confirmation. */
export function isMoveBack(
	position: ReadingPosition | null,
	choice: Choice,
): boolean {
	if (position === null || choice === "whole") return false;
	if (position.kind === "finished") return true;
	return Number(choice.slice(5)) < position.maxPosition;
}

/**
 * What a save did: `saved`; `confirm` when it would move the position back
 * and waits for `confirmMoveBack()` (see `pendingMoveBack`); `stale` when
 * the book's units changed and were reloaded, so choose again; `failed`
 * with `error` set.
 */
export type SaveResult = "saved" | "confirm" | "stale" | "failed";

export const readingPositionKey = (editionId: string) => [
	"reading-position",
	editionId,
];
export const readingUnitsKey = (editionId: string) => [
	"reading-units",
	editionId,
];

/**
 * The book's reading position and its units, with saving that only moves
 * forward unless a move back is confirmed. Every user of the hook shares the
 * query cache, so a save from one updates the others. Pass `enabled: false`
 * for editions that are not ready.
 */
export function useReadingPosition(
	editionId: string,
	{ enabled = true }: { enabled?: boolean } = {},
) {
	const queryClient = useQueryClient();
	const set = useServerFn(setReadingPositionFn);
	const clearFn = useServerFn(clearReadingPositionFn);
	const [pendingMoveBack, setPendingMoveBack] = useState<Choice | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const positionQuery = useQuery({
		queryKey: readingPositionKey(editionId),
		queryFn: () => getReadingPositionFn({ data: { editionId } }),
		enabled,
	});
	const unitsQuery = useQuery({
		queryKey: readingUnitsKey(editionId),
		queryFn: () => getReadingUnitsFn({ data: { editionId } }),
		enabled,
	});
	const position = positionQuery.data ?? null;
	const units = unitsQuery.data;

	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: readingPositionKey(editionId) });

	const run = async (
		choice: Choice,
		moveBack: boolean,
	): Promise<SaveResult> => {
		setBusy(true);
		setError(null);
		let outcome: SaveResult;
		try {
			const result = await set({
				data: { editionId, choice: toScope(choice), moveBack },
			});
			if (result.set) {
				setPendingMoveBack(null);
				outcome = "saved";
			} else if (result.reason === "move_back") {
				// Advanced elsewhere since this page loaded: confirm against the new position.
				setPendingMoveBack(choice);
				outcome = "confirm";
			} else if (result.reason === "stale_scope") {
				setPendingMoveBack(null);
				setError(STALE);
				await unitsQuery.refetch();
				outcome = "stale";
			} else {
				setPendingMoveBack(null);
				setError("This book is not ready.");
				outcome = "failed";
			}
			await refresh();
		} catch {
			setPendingMoveBack(null);
			setError("Could not save your reading position. Please try again.");
			outcome = "failed";
		}
		setBusy(false);
		return outcome;
	};

	/** Saves `choice`, or asks for confirmation first when it moves the position back. */
	const save = async (choice: Choice): Promise<SaveResult> => {
		if (isMoveBack(position, choice)) {
			setError(null);
			setPendingMoveBack(choice);
			return "confirm";
		}
		return run(choice, false);
	};

	/** Saves the pending move back. */
	const confirmMoveBack = async (): Promise<SaveResult> =>
		pendingMoveBack === null ? "failed" : run(pendingMoveBack, true);

	const cancelMoveBack = () => {
		if (!busy) setPendingMoveBack(null);
	};

	/** Clears the position back to unset. Resolves to whether it was cleared. */
	const clear = async (): Promise<boolean> => {
		setBusy(true);
		setError(null);
		let cleared = true;
		try {
			await clearFn({ data: { editionId } });
			await refresh();
		} catch {
			setError("Could not clear your reading position.");
			cleared = false;
		}
		setBusy(false);
		return cleared;
	};

	return {
		position,
		positionStatus: positionQuery.status,
		units,
		unitsStatus: unitsQuery.status,
		progress: readingProgress(position, units),
		save,
		clear,
		pendingMoveBack,
		confirmMoveBack,
		cancelMoveBack,
		busy,
		error,
		dismissError: () => setError(null),
	};
}
