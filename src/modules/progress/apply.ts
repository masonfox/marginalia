// Applying a provider reading to an edition's reading position (design D5):
// one source per book, provider wins on change, per-book opt-out.
import { and, asc, eq } from "drizzle-orm";
import { type ReadingPosition, writeSyncedPosition } from "#/modules/guide";
import { editions } from "#/modules/library";
import type { Database } from "#/server/db";
import { readingFingerprint } from "./fingerprint";
import { mapReading } from "./mapping";
import { loadMappingInput } from "./mapping-input";
import { progressLinks, progressProviders } from "./schema";
import type { ProgressReading, ProviderKind, StoredReading } from "./types";

export type ApplyResult =
	| {
			status: "applied";
			position: ReadingPosition | null;
			movedBackFrom: string | null;
	  }
	/** The reading's fingerprint matches the last applied one; a manual edit stands. */
	| { status: "unchanged" }
	/** The edition is excluded from sync. */
	| { status: "excluded" }
	/** Another enabled linked provider has priority, or this one is disabled. */
	| { status: "not-source"; source: ProviderKind | null }
	/** The edition is not ready, so it has no reading units to map onto. */
	| { status: "no-structure" }
	/** The edition does not exist or is not linked to this provider. */
	| { status: "not-linked" };

/** A reading in its jsonb form, with `observedAt` as ISO 8601. */
export function toStoredReading(reading: ProgressReading): StoredReading {
	const { observedAt, ...rest } = reading;
	return observedAt ? { ...rest, observedAt: observedAt.toISOString() } : rest;
}

/**
 * Applies `providerKind`'s reading to the edition, in one transaction. The
 * reading is always kept as the link's `last_reading`. It changes the
 * position only when the edition is not excluded, the provider is the
 * edition's source (the enabled linked provider with the lowest priority),
 * and the reading's fingerprint differs from the last one applied. Then it
 * is mapped onto the current reading units and written with no move-back
 * confirmation, and the fingerprint is stored with it.
 */
export async function applyReading(
	db: Database,
	editionId: string,
	providerKind: ProviderKind,
	reading: ProgressReading,
): Promise<ApplyResult> {
	return db.transaction(async (tx): Promise<ApplyResult> => {
		// Conflicts with the lock replaceEditionStructure takes, so units cannot change before the write.
		const [edition] = await tx
			.select({
				status: editions.status,
				excluded: editions.progressSyncExcluded,
			})
			.from(editions)
			.where(eq(editions.id, editionId))
			.for("share");
		if (!edition) return { status: "not-linked" };
		// Serializes applies of the same link.
		const [link] = await tx
			.select({ lastFingerprint: progressLinks.lastFingerprint })
			.from(progressLinks)
			.where(
				and(
					eq(progressLinks.editionId, editionId),
					eq(progressLinks.providerKind, providerKind),
				),
			)
			.for("update");
		if (!link) return { status: "not-linked" };

		const stored = toStoredReading(reading);
		const linkWhere = and(
			eq(progressLinks.editionId, editionId),
			eq(progressLinks.providerKind, providerKind),
		);
		await tx
			.update(progressLinks)
			.set({ lastReading: stored })
			.where(linkWhere);

		if (edition.excluded) return { status: "excluded" };
		const [source] = await tx
			.select({ kind: progressLinks.providerKind })
			.from(progressLinks)
			.innerJoin(
				progressProviders,
				eq(progressProviders.kind, progressLinks.providerKind),
			)
			.where(
				and(
					eq(progressLinks.editionId, editionId),
					eq(progressProviders.enabled, true),
				),
			)
			.orderBy(asc(progressProviders.priority))
			.limit(1);
		if (source?.kind !== providerKind)
			return { status: "not-source", source: source?.kind ?? null };

		const fingerprint = readingFingerprint(reading);
		if (fingerprint === link.lastFingerprint) return { status: "unchanged" };
		// Left unapplied, so the reading applies once the edition is ready.
		if (edition.status !== "ready") return { status: "no-structure" };

		const position = mapReading(reading, await loadMappingInput(tx, editionId));
		const { movedBackFrom } = await writeSyncedPosition(tx, editionId, {
			position,
			source: providerKind,
			sourceReading: stored,
		});
		await tx
			.update(progressLinks)
			.set({ lastFingerprint: fingerprint })
			.where(linkWhere);
		return { status: "applied", position, movedBackFrom };
	});
}
