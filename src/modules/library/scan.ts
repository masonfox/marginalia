import type { Dirent } from "node:fs";
import { opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "#/server/db";
import type { Enqueue } from "#/server/jobs/kinds";
import type { Logger } from "#/server/logger";
import { ensureEdition } from "./editions";
import { ensureSource, hashFile, recordFile } from "./files";
import { libraryFiles } from "./schema";

export interface ScanDeps {
	db: Database;
	libraryPaths: string[];
	enqueue: Enqueue;
	log: Pick<Logger, "info" | "warn">;
	/** Overridable for tests that count file reads. */
	hash?: (file: string) => Promise<string>;
}

export interface ScanStats {
	roots: number;
	seen: number;
	hashed: number;
	enqueued: number;
	missing: number;
	returned: number;
}

/**
 * The `library.scan` handler. Walks every configured root for `*.epub`
 * files, re-hashing only new files and files whose size or modification time
 * changed (or all files when `full`). Files no longer present are marked
 * missing; their editions stay readable and searchable. Library roots are
 * only ever read.
 */
export async function scanLibraries(
	deps: ScanDeps,
	{ full = false } = {},
): Promise<ScanStats> {
	const stats: ScanStats = {
		roots: 0,
		seen: 0,
		hashed: 0,
		enqueued: 0,
		missing: 0,
		returned: 0,
	};
	for (const configured of deps.libraryPaths) {
		const root = path.resolve(configured);
		let realRoot: string;
		try {
			realRoot = await realpath(root);
			if (!(await stat(realRoot)).isDirectory())
				throw new Error("not a directory");
		} catch (err) {
			// An unavailable mount is skipped rather than marking every file missing.
			deps.log.warn({ root, err }, "library root is not readable; skipping");
			continue;
		}
		stats.roots++;
		await scanRoot(deps, root, realRoot, full, stats);
	}
	deps.log.info(stats, "library scan finished");
	return stats;
}

async function scanRoot(
	deps: ScanDeps,
	root: string,
	realRoot: string,
	full: boolean,
	stats: ScanStats,
) {
	const { db } = deps;
	const hash = deps.hash ?? hashFile;
	const source = await ensureSource(db, "filesystem", root);
	const known = new Map(
		(
			await db
				.select()
				.from(libraryFiles)
				.where(eq(libraryFiles.sourceId, source.id))
		).map((f) => [f.relPath, f]),
	);
	const seen = new Set<string>();
	const unchanged: number[] = [];

	for await (const file of walkEpubs(realRoot, deps.log)) {
		const relPath = path
			.relative(realRoot, file.logicalPath)
			.split(path.sep)
			.join("/");
		seen.add(relPath);
		stats.seen++;
		const size = file.size;
		const mtime = new Date(Math.floor(file.mtimeMs));
		const row = known.get(relPath);
		if (
			!full &&
			row &&
			row.size === size &&
			row.mtime.getTime() === mtime.getTime()
		) {
			if (row.status === "missing") stats.returned++;
			unchanged.push(row.id);
			continue;
		}

		const sha256 = await hash(file.realPath);
		stats.hashed++;
		await recordFile(db, { sourceId: source.id, relPath, size, mtime, sha256 });
		const title = path.basename(relPath).replace(/\.epub$/i, "");
		const { edition } = await ensureEdition(db, sha256, title);
		if (edition.status === "processing") {
			if (await deps.enqueue("library.ingest", { sha256 })) stats.enqueued++;
		}
	}

	for (const ids of chunk(unchanged, 1000)) {
		await db
			.update(libraryFiles)
			.set({ status: "available", lastSeenAt: sql`now()` })
			.where(inArray(libraryFiles.id, ids));
	}
	const gone = [...known.values()]
		.filter((f) => f.status === "available" && !seen.has(f.relPath))
		.map((f) => f.id);
	for (const ids of chunk(gone, 1000)) {
		await db
			.update(libraryFiles)
			.set({ status: "missing" })
			.where(
				and(
					eq(libraryFiles.sourceId, source.id),
					inArray(libraryFiles.id, ids),
				),
			);
	}
	stats.missing += gone.length;
}

interface FoundFile {
	/** Path as reached from the root (symlinks unresolved), used for the relative path. */
	logicalPath: string;
	realPath: string;
	size: number;
	mtimeMs: number;
}

/** Recursively yields `*.epub` files, following symlinks only when they resolve inside the root. */
async function* walkEpubs(
	realRoot: string,
	log: Pick<Logger, "warn">,
): AsyncGenerator<FoundFile> {
	const visited = new Set<string>([realRoot]);
	const stack: string[] = [realRoot];
	const inside = (p: string) =>
		p === realRoot || p.startsWith(realRoot + path.sep);

	while (stack.length > 0) {
		const dir = stack.pop() as string;
		let entries: Dirent[];
		try {
			const handle = await opendir(dir);
			entries = [];
			for await (const entry of handle) entries.push(entry);
		} catch (err) {
			log.warn({ dir, err }, "cannot read library directory");
			continue;
		}
		entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const entry of entries) {
			const logicalPath = path.join(dir, entry.name);
			let realPath = logicalPath;
			if (entry.isSymbolicLink()) {
				try {
					realPath = await realpath(logicalPath);
				} catch {
					continue;
				}
				if (!inside(realPath)) continue;
			}
			let info: Awaited<ReturnType<typeof stat>>;
			try {
				info = await stat(realPath);
			} catch {
				continue;
			}
			if (info.isDirectory()) {
				if (!visited.has(realPath)) {
					visited.add(realPath);
					stack.push(logicalPath);
				}
			} else if (info.isFile() && /\.epub$/i.test(entry.name)) {
				yield { logicalPath, realPath, size: info.size, mtimeMs: info.mtimeMs };
			}
		}
	}
}

function* chunk<T>(items: T[], size: number): Generator<T[]> {
	for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
