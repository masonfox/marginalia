// The per-book opt-out from progress sync (progress-sync spec "Per-book
// opt-out"): an excluded edition keeps its position whatever its providers
// report.
import { eq } from "drizzle-orm";
import { editions } from "#/modules/library";
import type { Database } from "#/server/db";
import { progressLinks } from "./schema";

/**
 * Excludes the edition from sync, or includes it again. Including it forgets
 * its links' fingerprints, so the next sync applies the source provider's
 * current reading even when it has not changed since it was last applied
 * (for example over a position set by hand while excluded). Returns false
 * when the edition does not exist.
 */
export async function setSyncExcluded(
	db: Database,
	editionId: string,
	excluded: boolean,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const rows = await tx
			.update(editions)
			.set({ progressSyncExcluded: excluded })
			.where(eq(editions.id, editionId))
			.returning({ id: editions.id });
		if (rows.length === 0) return false;
		if (!excluded)
			await tx
				.update(progressLinks)
				.set({ lastFingerprint: null })
				.where(eq(progressLinks.editionId, editionId));
		return true;
	});
}
