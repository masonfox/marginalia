import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Executor } from "#/server/db";
import { libraryFiles, librarySources } from "./schema";

export type SourceKind = "upload" | "filesystem";

/** Directory holding uploaded EPUBs, named by content hash. */
export function booksDir(dataDir: string): string {
	return path.join(dataDir, "books");
}

export function uploadedBookPath(dataDir: string, sha256: string): string {
	return path.join(booksDir(dataDir), `${sha256}.epub`);
}

/**
 * Uploads are recorded as `<sha256>/<original file name>`: unique per content
 * and name, while keeping the name for display and the title fallback.
 */
export function uploadRelPath(sha256: string, fileName: string): string {
	return `${sha256}/${path.basename(fileName.replaceAll("\\", "/")) || "upload.epub"}`;
}

export async function ensureSource(
	db: Executor,
	kind: SourceKind,
	rootPath: string,
) {
	await db
		.insert(librarySources)
		.values({ kind, rootPath })
		.onConflictDoNothing();
	const [row] = await db
		.select()
		.from(librarySources)
		.where(
			and(eq(librarySources.kind, kind), eq(librarySources.rootPath, rootPath)),
		);
	return row as typeof librarySources.$inferSelect;
}

export interface FileRecord {
	sourceId: number;
	relPath: string;
	size: number;
	mtime: Date;
	sha256: string;
}

/** Inserts or updates a file row and marks it available. */
export async function recordFile(db: Executor, file: FileRecord) {
	await db
		.insert(libraryFiles)
		.values({ ...file, status: "available", lastSeenAt: sql`now()` })
		.onConflictDoUpdate({
			target: [libraryFiles.sourceId, libraryFiles.relPath],
			set: {
				size: file.size,
				mtime: file.mtime,
				sha256: file.sha256,
				status: "available",
				lastSeenAt: sql`now()`,
			},
		});
}

export interface ReadableFile {
	/** Absolute path to the EPUB bytes. */
	path: string;
	/** Original file name, for the title fallback. */
	fileName: string;
}

/** An available copy of the edition's bytes, preferring uploads. */
export async function findReadableFile(
	db: Executor,
	dataDir: string,
	sha256: string,
): Promise<ReadableFile | null> {
	const rows = await db
		.select({
			kind: librarySources.kind,
			rootPath: librarySources.rootPath,
			relPath: libraryFiles.relPath,
		})
		.from(libraryFiles)
		.innerJoin(librarySources, eq(libraryFiles.sourceId, librarySources.id))
		.where(
			and(
				eq(libraryFiles.sha256, sha256),
				eq(libraryFiles.status, "available"),
			),
		)
		.orderBy(asc(librarySources.kind), asc(libraryFiles.id));
	const upload = rows.find((r) => r.kind === "upload");
	if (upload) {
		return {
			path: uploadedBookPath(dataDir, sha256),
			fileName: path.posix.basename(upload.relPath),
		};
	}
	const file = rows[0];
	if (!file) return null;
	return {
		path: path.join(file.rootPath, ...file.relPath.split("/")),
		fileName: path.posix.basename(file.relPath),
	};
}

export async function hashFile(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	await pipeline(createReadStream(filePath), hash);
	return hash.digest("hex");
}
