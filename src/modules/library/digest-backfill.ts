import { and, asc, gt, isNull } from "drizzle-orm";
import type { Executor } from "#/server/db";
import type { Logger } from "#/server/logger";
import { setKoreaderDigest } from "./editions";
import { findReadableFile } from "./files";
import { koreaderDigest } from "./koreader-digest";
import { editions } from "./schema";

export interface DigestBackfillDeps {
	db: Executor;
	dataDir: string;
	log: Pick<Logger, "info" | "warn">;
}

export interface DigestBackfillStats {
	filled: number;
	/** Editions with no available library file; they keep a null digest. */
	unavailable: number;
	/** Editions whose file could not be read. */
	failed: number;
}

const PAGE = 500;

/**
 * Fills `koreader_digest` for editions that have none, from any available
 * library file of the edition. Idempotent: only editions still missing a
 * digest are read, so a rerun after completion does one query.
 */
export async function backfillKoreaderDigests(
	deps: DigestBackfillDeps,
	signal?: AbortSignal,
): Promise<DigestBackfillStats> {
	const { db, dataDir, log } = deps;
	const stats: DigestBackfillStats = { filled: 0, unavailable: 0, failed: 0 };
	// Keyset paging by id, so editions left null (no file) are not revisited.
	let after: string | undefined;
	for (;;) {
		signal?.throwIfAborted();
		const page = await db
			.select({ id: editions.id, sha256: editions.sha256 })
			.from(editions)
			.where(
				and(
					isNull(editions.koreaderDigest),
					after === undefined ? undefined : gt(editions.id, after),
				),
			)
			.orderBy(asc(editions.id))
			.limit(PAGE);
		for (const edition of page) {
			signal?.throwIfAborted();
			const file = await findReadableFile(db, dataDir, edition.sha256);
			if (!file) {
				stats.unavailable++;
				continue;
			}
			try {
				await setKoreaderDigest(
					db,
					edition.id,
					await koreaderDigest(file.path),
				);
				stats.filled++;
			} catch (err) {
				// A row marked available whose file is gone; the next scan marks it missing.
				stats.failed++;
				log.warn(
					{ editionId: edition.id, err },
					"could not compute KOReader digest",
				);
			}
		}
		if (page.length < PAGE) break;
		after = page[page.length - 1]?.id;
	}
	if (stats.filled + stats.unavailable + stats.failed > 0) {
		log.info(stats, "KOReader digest backfill finished");
	}
	return stats;
}
