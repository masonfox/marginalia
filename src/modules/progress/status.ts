// What the position control shows about a book's sync (reading-position
// spec "Position source"; design D5): who set the position, from which
// reading, when, and whether that moved it back.
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { clearReadingPosition, readingPositions } from "#/modules/guide";
import { editions } from "#/modules/library";
import type { Database, Executor } from "#/server/db";
import { progressLinks, progressProviders } from "./schema";
import type {
	LinkMatchedBy,
	PositionSource,
	ProviderKind,
	StoredReading,
} from "./types";

export interface SyncStatus {
	/**
	 * Who set the current position: a provider, the reader, or null when the
	 * position is unset and no sync detail stands.
	 */
	source: PositionSource | null;
	/** The raw reading a provider's position came from; null when manual. */
	reading: StoredReading | null;
	appliedAt: Date | null;
	/** The previous unit label, when that sync moved the position back. */
	movedBackFrom: string | null;
	excluded: boolean;
	/** The edition's live links (rejected ones left out), in priority order. */
	links: { kind: ProviderKind; matchedBy: LinkMatchedBy; enabled: boolean }[];
}

/**
 * The edition's sync status, or null when it does not exist. A position row
 * holds its own source details. With no row, the most recently applied link
 * details stand: a sync that mapped to unset deleted the row and kept them on
 * the link. A manual write wins over them: setting a position creates a
 * manual row, and {@link clearPositionByHand} forgets them.
 */
export async function getSyncStatus(
	db: Executor,
	editionId: string,
): Promise<SyncStatus | null> {
	const [[edition], [row], links] = await Promise.all([
		db
			.select({ excluded: editions.progressSyncExcluded })
			.from(editions)
			.where(eq(editions.id, editionId)),
		db
			.select({
				source: readingPositions.source,
				sourceReading: readingPositions.sourceReading,
				syncedAt: readingPositions.syncedAt,
				movedBackFrom: readingPositions.movedBackFrom,
			})
			.from(readingPositions)
			.where(eq(readingPositions.editionId, editionId)),
		db
			.select({
				kind: progressLinks.providerKind,
				matchedBy: progressLinks.matchedBy,
				enabled: progressProviders.enabled,
				appliedReading: progressLinks.appliedReading,
				appliedAt: progressLinks.appliedAt,
				movedBackFrom: progressLinks.movedBackFrom,
			})
			.from(progressLinks)
			.innerJoin(
				progressProviders,
				eq(progressProviders.kind, progressLinks.providerKind),
			)
			.where(
				and(
					eq(progressLinks.editionId, editionId),
					ne(progressLinks.matchedBy, "rejected"),
				),
			)
			.orderBy(asc(progressProviders.priority)),
	]);
	if (!edition) return null;
	const status: SyncStatus = {
		source: null,
		reading: null,
		appliedAt: null,
		movedBackFrom: null,
		excluded: edition.excluded,
		links: links.map(({ kind, matchedBy, enabled }) => ({
			kind,
			matchedBy,
			enabled,
		})),
	};
	if (row) {
		if (row.source === "manual") return { ...status, source: "manual" };
		return {
			...status,
			source: row.source,
			reading: row.sourceReading ?? null,
			appliedAt: row.syncedAt,
			movedBackFrom: row.movedBackFrom,
		};
	}
	let latest: (typeof links)[number] | undefined;
	for (const link of links) {
		if (!link.appliedAt) continue;
		if (!latest?.appliedAt || link.appliedAt > latest.appliedAt) latest = link;
	}
	if (!latest) return status;
	return {
		...status,
		source: latest.kind,
		reading: latest.appliedReading,
		appliedAt: latest.appliedAt,
		movedBackFrom: latest.movedBackFrom,
	};
}

/**
 * Clears the edition's position by hand: the position becomes unset and the
 * links' applied details are forgotten, so the control no longer shows the
 * last sync. The fingerprints stay, so an unchanged reading does not undo
 * the clear. Returns whether a position was set.
 */
export async function clearPositionByHand(
	db: Database,
	editionId: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const cleared = await clearReadingPosition(tx, editionId);
		await tx
			.update(progressLinks)
			.set({ appliedReading: null, appliedAt: null, movedBackFrom: null })
			.where(
				and(
					eq(progressLinks.editionId, editionId),
					isNotNull(progressLinks.appliedAt),
				),
			);
		return cleared;
	});
}
