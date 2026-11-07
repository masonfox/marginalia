import { RefreshCw } from "lucide-react";
import { Button } from "#/components/ui/button";
import type { useBookSync } from "#/hooks/use-book-sync";
import { relativeTime } from "#/lib/relative-time";
import { movedBackText, readingText } from "#/lib/sync-reading";

type BookSync = ReturnType<typeof useBookSync>;

/**
 * Who set the reading position, under it: "Synced from Hardcover · 42% · 2
 * hours ago" and, when that sync moved it earlier, "Moved back from Chapter
 * 14", even when the sync cleared it to unset. "Set by hand" when the reader
 * set a synced book's position. Nothing for a book without sync, or one
 * excluded from it.
 */
export function SyncDetails({
	sync,
	now,
}: {
	sync: BookSync;
	/** For tests; defaults to the time of rendering. */
	now?: Date;
}) {
	const { status } = sync;
	if (!status || status.excluded || status.source === null) return null;
	if (status.source === "manual")
		return status.linked ? (
			<p
				className="mt-1.5 text-xs text-muted-foreground"
				data-testid="position-source"
			>
				Set by hand
			</p>
		) : null;
	const parts = [
		`Synced from ${status.sourceLabel ?? status.source}`,
		status.reading && readingText(status.reading),
		status.appliedAt && relativeTime(status.appliedAt, now),
	].filter(Boolean);
	return (
		<div className="mt-1.5 text-xs text-muted-foreground">
			<p data-testid="position-source">{parts.join(" · ")}</p>
			{status.movedBackFrom !== null && (
				<p className="break-words" data-testid="position-moved-back">
					{movedBackText(status.movedBackFrom)}
				</p>
			)}
		</div>
	);
}

/**
 * "Sync" and "Exclude from sync" for a book with an enabled linked provider;
 * only "Include in sync" once it is excluded. Nothing otherwise.
 */
export function SyncActions({
	sync,
	compact = false,
}: {
	sync: BookSync;
	compact?: boolean;
}) {
	const { status, syncing, changing } = sync;
	if (!status || !(status.linked || status.excluded)) return null;
	const size = compact ? "sm" : "default";
	const touch = compact ? "pointer-coarse:h-11" : undefined;
	if (status.excluded)
		return (
			<>
				<span className="text-xs text-muted-foreground">
					Excluded from sync
				</span>
				<Button
					type="button"
					size={size}
					variant="ghost"
					className={touch}
					disabled={changing}
					onClick={() => void sync.setSyncExcluded(false)}
				>
					Include in sync
				</Button>
			</>
		);
	return (
		<>
			<Button
				type="button"
				size={size}
				variant="ghost"
				className={touch}
				disabled={syncing || changing}
				aria-busy={syncing}
				onClick={() => void sync.syncNow()}
			>
				<RefreshCw
					className={syncing ? "animate-spin" : undefined}
					aria-hidden
				/>
				Sync
			</Button>
			<Button
				type="button"
				size={size}
				variant="ghost"
				className={touch}
				disabled={syncing || changing}
				onClick={() => void sync.setSyncExcluded(true)}
			>
				Exclude from sync
			</Button>
		</>
	);
}

/** The sync's progress or result, and errors, for screen readers too. */
export function SyncMessage({ sync }: { sync: BookSync }) {
	const { status, pending, outcome, error } = sync;
	if (error)
		return (
			<p
				role="alert"
				className="basis-full text-xs text-destructive-foreground"
			>
				{error}
			</p>
		);
	const text =
		status?.excluded || (!status?.linked && !pending)
			? null
			: pending === "queued"
				? "Sync queued…"
				: pending === "active"
					? "Syncing…"
					: outcome === "updated"
						? "Synced: position updated."
						: outcome === "unchanged"
							? "Synced: nothing new to apply."
							: null;
	return (
		<output
			className="block basis-full text-xs text-muted-foreground empty:hidden"
			data-testid="book-sync-message"
		>
			{text}
		</output>
	);
}
