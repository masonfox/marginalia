import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Database } from "#/server/db";
import type { Enqueue } from "#/server/jobs/kinds";
import { getEdition, setEditionStatus } from "./editions";
import { editions } from "./schema";

/** Enqueues a scan of every library root unless one is already pending or running. */
export async function requestRescan(enqueue: Enqueue, { full = false } = {}) {
	return { enqueued: (await enqueue("library.scan", { full })) !== null };
}

/** Re-enqueues ingestion of a failed edition. */
export async function retryImport(
	db: Database,
	enqueue: Enqueue,
	editionId: string,
) {
	const edition = await getEdition(db, editionId);
	if (!edition) return { enqueued: false, reason: "not_found" as const };
	if (edition.status !== "failed")
		return { enqueued: false, reason: "not_failed" as const };
	await setEditionStatus(db, editionId, "processing");
	const id = await enqueue("library.ingest", { sha256: edition.sha256 });
	return { enqueued: id !== null };
}

/**
 * Enqueues a reparse for a ready edition parsed with an older parser version,
 * or for every such edition when no id is given.
 */
export async function reparseOutdated(
	db: Database,
	enqueue: Enqueue,
	currentParserVersion: number,
	editionId?: string,
) {
	const outdated = await db
		.select({ id: editions.id })
		.from(editions)
		.where(
			and(
				eq(editions.status, "ready"),
				or(
					isNull(editions.parserVersion),
					lt(editions.parserVersion, currentParserVersion),
				),
				editionId ? eq(editions.id, editionId) : undefined,
			),
		);
	let enqueued = 0;
	for (const { id } of outdated) {
		if (await enqueue("catalog.reparse", { editionId: id })) enqueued++;
	}
	return { outdated: outdated.length, enqueued };
}
