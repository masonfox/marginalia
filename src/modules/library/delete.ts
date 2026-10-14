import { rm } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import type { Database, Executor } from "#/server/db";
import type { Logger } from "#/server/logger";
import { getEditionBySha } from "./editions";
import { uploadedBookPath } from "./files";
import {
	editions,
	excludedEditions,
	libraryFiles,
	librarySources,
} from "./schema";

export type DeleteResult =
	| { deleted: true }
	| { deleted: false; reason: "not_found" };

/**
 * Permanently deletes an edition: its structure (by cascade), its upload
 * source rows, its uploaded EPUB, and its cover. The content hash is added to
 * the exclusion list so scans skip it. Filesystem `library_files` rows are
 * kept: they describe files in read-only library roots, keep unchanged files
 * on the scanner's no-hash path, and reappear as sources if the bytes are
 * uploaded again. Files are removed only after the transaction commits.
 */
export async function deleteEdition(
	db: Database,
	dataDir: string,
	editionId: string,
	log: Pick<Logger, "info" | "warn">,
): Promise<DeleteResult> {
	const deleted = await db.transaction(async (tx) => {
		const [edition] = await tx
			.select()
			.from(editions)
			.where(eq(editions.id, editionId))
			.for("update");
		if (!edition) return null;
		await tx
			.insert(excludedEditions)
			.values({ sha256: edition.sha256, title: edition.title })
			.onConflictDoUpdate({
				target: excludedEditions.sha256,
				set: { title: edition.title, excludedAt: new Date() },
			});
		const uploadSources = tx
			.select({ id: librarySources.id })
			.from(librarySources)
			.where(eq(librarySources.kind, "upload"));
		await tx
			.delete(libraryFiles)
			.where(
				and(
					eq(libraryFiles.sha256, edition.sha256),
					inArray(libraryFiles.sourceId, uploadSources),
				),
			);
		await tx.delete(editions).where(eq(editions.id, edition.id));
		return edition;
	});
	if (!deleted) return { deleted: false, reason: "not_found" };

	const files = [uploadedBookPath(dataDir, deleted.sha256)];
	if (deleted.coverPath) files.push(path.join(dataDir, deleted.coverPath));
	await removeUnlessReimported(db, deleted.sha256, files, log);
	log.info({ editionId: deleted.id, title: deleted.title }, "edition deleted");
	return { deleted: true };
}

/**
 * Removes content-addressed files for `sha256`, unless an edition with those
 * bytes exists again (re-uploaded since the delete committed). Failures are
 * logged: an orphaned file is unreferenced and harmless.
 */
export async function removeUnlessReimported(
	db: Executor,
	sha256: string,
	files: string[],
	log: Pick<Logger, "warn">,
) {
	for (const file of files) {
		if (await getEditionBySha(db, sha256)) return;
		try {
			await rm(file, { force: true, maxRetries: 5 });
		} catch (err) {
			log.warn({ file, err }, "could not remove a deleted edition's file");
		}
	}
}
