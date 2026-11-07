import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
	getBookSyncFn,
	setBookSyncExcludedFn,
	syncBookFn,
} from "#/fns/progress-book";
import { unlinkBookFn } from "#/fns/progress-settings";
import { readingPositionKey } from "#/hooks/use-reading-position";
import type { ProviderKind } from "#/modules/progress";

/**
 * Under the reading position's key, so every refresh of the position (a save
 * here, or anywhere that invalidates it) refreshes the sync status too.
 */
export const bookSyncKey = (editionId: string) => [
	...readingPositionKey(editionId),
	"sync",
];

/** How often a pending one-book sync is checked on. */
export const SYNC_POLL_MS = 2_000;

/**
 * What the last "Sync" click did, once its job finished: `updated` when it
 * applied a reading, `unchanged` when nothing new was applied.
 */
export type BookSyncOutcome = "updated" | "unchanged" | null;

/** A provider link the reader can remove from the position control. */
export interface BookSyncLink {
	kind: ProviderKind;
	label: string;
	/** Matched automatically: unlinking keeps it from being matched again. */
	auto: boolean;
}

/**
 * The book's progress-sync status for the position control, with its "Sync"
 * and "Exclude from sync" actions. A queued sync is polled until its job
 * settles, then the position is reloaded.
 */
export function useBookSync(
	editionId: string,
	{ enabled = true }: { enabled?: boolean } = {},
) {
	const queryClient = useQueryClient();
	const sync = useServerFn(syncBookFn);
	const setExcluded = useServerFn(setBookSyncExcludedFn);
	const unlinkBook = useServerFn(unlinkBookFn);
	const [starting, setStarting] = useState(false);
	const [changing, setChanging] = useState(false);
	/** The link whose "Unlink" waits for confirmation. */
	const [confirmingUnlink, setConfirmingUnlink] = useState<
		BookSyncLink["kind"] | null
	>(null);
	/** The link just removed, for the note under the control. */
	const [unlinked, setUnlinked] = useState<BookSyncLink | null>(null);
	const [outcome, setOutcome] = useState<BookSyncOutcome>(null);
	const [error, setError] = useState<string | null>(null);
	const query = useQuery({
		queryKey: bookSyncKey(editionId),
		queryFn: () => getBookSyncFn({ data: { editionId } }),
		enabled,
		refetchInterval: (q) => (q.state.data?.pending ? SYNC_POLL_MS : false),
	});
	const status = query.data ?? null;
	const pending = status?.pending ?? null;

	// The applied time when the reader asked for a sync, while waiting for it.
	const watching = useRef<{ appliedAt: number | null } | null>(null);
	const wasPending = useRef(false);

	/** The sync job settled: reload the position and say what it did. */
	const settle = (appliedAt: Date | null) => {
		const asked = watching.current;
		watching.current = null;
		void queryClient.invalidateQueries({
			queryKey: readingPositionKey(editionId),
		});
		if (asked)
			setOutcome(
				(appliedAt?.getTime() ?? null) !== asked.appliedAt
					? "updated"
					: "unchanged",
			);
	};
	const settleRef = useRef(settle);
	settleRef.current = settle;

	useEffect(() => {
		if (pending) {
			wasPending.current = true;
			return;
		}
		if (!wasPending.current || !status) return;
		wasPending.current = false;
		settleRef.current(status.appliedAt);
	}, [pending, status]);

	/** Queues a sync of this book, unless one is already pending. */
	const syncNow = async () => {
		if (starting || pending) return;
		setStarting(true);
		setError(null);
		setOutcome(null);
		setUnlinked(null);
		const appliedAt = status?.appliedAt?.getTime() ?? null;
		try {
			await sync({ data: { editionId } });
			watching.current = { appliedAt };
			const { data } = await query.refetch();
			// Already done before the first check: no pending state to wait out.
			if (data && !data.pending) settle(data.appliedAt);
		} catch {
			watching.current = null;
			setError("Could not start a sync. Please try again.");
		}
		setStarting(false);
	};

	/** Excludes the book from sync, or includes it again. */
	const setSyncExcluded = async (excluded: boolean) => {
		setChanging(true);
		setError(null);
		setOutcome(null);
		setUnlinked(null);
		try {
			await setExcluded({ data: { editionId, excluded } });
			await query.refetch();
		} catch {
			setError(
				excluded
					? "Could not exclude this book from sync."
					: "Could not include this book in sync.",
			);
		}
		setChanging(false);
	};

	/** Asks to confirm unlinking a provider, or stops asking (null). */
	const askUnlink = (kind: BookSyncLink["kind"] | null) => {
		setConfirmingUnlink(kind);
		if (kind) {
			setError(null);
			setOutcome(null);
			setUnlinked(null);
		}
	};

	/** Removes the confirmed link, then reloads the position and its sync. */
	const unlink = async (link: BookSyncLink) => {
		setChanging(true);
		setError(null);
		setOutcome(null);
		setUnlinked(null);
		try {
			await unlinkBook({ data: { editionId, kind: link.kind } });
			setConfirmingUnlink(null);
			setUnlinked(link);
			await queryClient.invalidateQueries({
				queryKey: readingPositionKey(editionId),
			});
		} catch {
			setError(`Could not unlink this book from ${link.label}.`);
		}
		setChanging(false);
	};

	return {
		status,
		/** The sync is being queued, or its job waits or runs. */
		syncing: starting || pending !== null,
		pending,
		changing,
		outcome,
		error,
		confirmingUnlink,
		unlinked,
		syncNow,
		setSyncExcluded,
		askUnlink,
		unlink,
	};
}
