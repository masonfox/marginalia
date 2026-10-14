import path from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import type { Executor } from "#/server/db";
import { editions, libraryFiles, librarySources } from "./schema";

export type DisplayStatus = "processing" | "ready" | "failed" | "unavailable";

export interface EditionSummary {
	id: string;
	title: string;
	authors: string[];
	status: DisplayStatus;
	error: string | null;
	hasCover: boolean;
}

const availableExpr = sql<boolean>`exists (
	select 1 from ${libraryFiles}
	where ${libraryFiles.sha256} = ${editions.sha256} and ${libraryFiles.status} = 'available'
)`;

/** A ready edition with no available source is shown as unavailable (derived, not stored). */
function displayStatus(status: string, available: boolean): DisplayStatus {
	if (status === "ready" && !available) return "unavailable";
	return status as DisplayStatus;
}

export async function listEditions(db: Executor): Promise<EditionSummary[]> {
	const rows = await db
		.select({
			id: editions.id,
			title: editions.title,
			authors: editions.authors,
			status: editions.status,
			error: editions.error,
			coverPath: editions.coverPath,
			available: availableExpr,
		})
		.from(editions)
		.orderBy(sql`lower(${editions.title})`, asc(editions.createdAt));
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		authors: r.authors,
		status: displayStatus(r.status, r.available),
		error: r.error,
		hasCover: r.coverPath !== null,
	}));
}

export interface EditionSource {
	kind: "upload" | "filesystem";
	/** The library path, or the original file name for uploads. */
	label: string;
	available: boolean;
}

export async function getEditionDetail(db: Executor, id: string) {
	const [row] = await db
		.select({ edition: editions, available: availableExpr })
		.from(editions)
		.where(eq(editions.id, id));
	if (!row) return null;
	const files = await db
		.select({
			kind: librarySources.kind,
			rootPath: librarySources.rootPath,
			relPath: libraryFiles.relPath,
			status: libraryFiles.status,
		})
		.from(libraryFiles)
		.innerJoin(librarySources, eq(libraryFiles.sourceId, librarySources.id))
		.where(eq(libraryFiles.sha256, row.edition.sha256))
		.orderBy(asc(librarySources.kind), asc(libraryFiles.relPath));
	const sources: EditionSource[] = files.map((f) => ({
		kind: f.kind,
		label:
			f.kind === "upload"
				? path.posix.basename(f.relPath)
				: path.join(f.rootPath, ...f.relPath.split("/")),
		available: f.status === "available",
	}));
	const { sha256: _sha, ...edition } = row.edition;
	return {
		...edition,
		displayStatus: displayStatus(row.edition.status, row.available),
		sources,
	};
}

export async function getCoverPath(
	db: Executor,
	id: string,
): Promise<string | null> {
	const [row] = await db
		.select({ coverPath: editions.coverPath })
		.from(editions)
		.where(eq(editions.id, id));
	return row?.coverPath ?? null;
}
