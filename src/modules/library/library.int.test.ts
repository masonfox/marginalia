import {
	chmod,
	cp,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	ingestEdition,
	locatorAliases,
	noteRefs,
	passages,
	sections,
	tocEntries,
} from "#/modules/catalog";
import { PARSER_VERSION } from "#/modules/epub";
import { JobRuntime } from "#/server/jobs";
import type { Enqueue, JobKind, JobPayload } from "#/server/jobs/kinds";
import { createTestDb, type TestDb } from "../../../test/db";
import { fixtures } from "../../../test/fixtures";
import {
	addUploadedBook,
	sha256Of,
	silentLog,
	tempDataDir,
} from "../../../test/library";
import {
	deleteEdition,
	editions,
	excludedEditions,
	getEdition,
	getEditionBySha,
	getEditionDetail,
	handleUploadRequest,
	hashFile,
	isEditionAvailable,
	libraryFiles,
	listEditions,
	reparseOutdated,
	requestRescan,
	retryImport,
	scanLibraries,
	setEditionStatus,
	uploadedBookPath,
} from ".";

let t: TestDb;
/** Each describe block gets its own database so editions never leak between them. */
const freshDb = () =>
	beforeAll(async () => {
		t = await createTestDb();
	});

function recordingEnqueue() {
	const calls: { kind: JobKind; payload: unknown }[] = [];
	const enqueue: Enqueue = async <K extends JobKind>(
		kind: K,
		payload: JobPayload<K>,
	) => {
		calls.push({ kind, payload });
		return `job-${calls.length}`;
	};
	return { calls, enqueue };
}

function uploadRequest(bytes: Buffer, fileName = "book.epub", field = "file") {
	const form = new FormData();
	form.set(field, new Blob([new Uint8Array(bytes)]), fileName);
	return new Request("http://localhost/api/uploads", {
		method: "POST",
		body: form,
	});
}

async function filesIn(dir: string): Promise<string[]> {
	return (await readdir(dir, { recursive: true }).catch(() => []))
		.map(String)
		.sort();
}

describe("upload", () => {
	freshDb();
	let dataDir: string;
	const deps = (enqueue: Enqueue, maxUploadMb = 1) => ({
		db: t.db,
		dataDir,
		maxUploadMb,
		enqueue,
		log: silentLog,
	});

	beforeEach(async () => {
		dataDir = await tempDataDir();
	});

	it("stores a valid EPUB, creates a processing edition, and enqueues ingestion", async () => {
		const bytes = await fixtures.epub3();
		const { calls, enqueue } = recordingEnqueue();
		const res = await handleUploadRequest(
			uploadRequest(bytes, "My Book.epub"),
			deps(enqueue),
		);
		expect(res.status).toBe(201);
		const body = await res.json();
		const sha256 = sha256Of(bytes);
		expect(body).toMatchObject({ created: true, status: "processing" });
		expect(await stat(uploadedBookPath(dataDir, sha256))).toBeTruthy();
		expect(await getEdition(t.db, body.editionId)).toMatchObject({
			sha256,
			title: "My Book",
			status: "processing",
		});
		expect(calls).toEqual([{ kind: "library.ingest", payload: { sha256 } }]);
		expect(await filesIn(path.join(dataDir, "tmp"))).toEqual([]);
	});

	it("returns an absolute https Location when reached through a proxy", async () => {
		const { enqueue } = recordingEnqueue();
		const form = new FormData();
		form.set(
			"file",
			new Blob([new Uint8Array(await fixtures.fragments())]),
			"f.epub",
		);
		const res = await handleUploadRequest(
			new Request("http://app:3000/api/uploads", {
				method: "POST",
				body: form,
				headers: {
					"x-forwarded-proto": "https",
					"x-forwarded-host": "books.example.com",
				},
			}),
			deps(enqueue),
		);
		const { editionId } = await res.json();
		expect(res.headers.get("location")).toBe(
			`https://books.example.com/books/${editionId}`,
		);
	});

	it("rejects an oversize upload during streaming and stores nothing", async () => {
		const big = Buffer.concat([
			await fixtures.epub3(),
			Buffer.alloc(1.5 * 1024 * 1024, 1),
		]);
		const { calls, enqueue } = recordingEnqueue();
		const [before] = await t.db.select({ n: count() }).from(editions);
		const res = await handleUploadRequest(uploadRequest(big), deps(enqueue, 1));
		expect(res.status).toBe(413);
		expect((await res.json()).error).toBe(
			"The file is larger than the 1 MB upload limit.",
		);
		const [after] = await t.db.select({ n: count() }).from(editions);
		expect(after?.n).toBe(before?.n);
		expect(calls).toEqual([]);
		expect(await filesIn(path.join(dataDir, "tmp"))).toEqual([]);
		expect(await filesIn(path.join(dataDir, "books"))).toEqual([]);
	});

	it("rejects a file that is not an EPUB and stores nothing", async () => {
		const { calls, enqueue } = recordingEnqueue();
		for (const bytes of [
			await fixtures.notAZip(),
			await fixtures.zipWithoutEpub(),
		]) {
			const res = await handleUploadRequest(
				uploadRequest(bytes, "x.epub"),
				deps(enqueue),
			);
			expect(res.status).toBe(400);
			expect((await res.json()).error).toMatch(/not a valid EPUB/);
		}
		expect(calls).toEqual([]);
		expect(await filesIn(path.join(dataDir, "tmp"))).toEqual([]);
		expect(await filesIn(path.join(dataDir, "books"))).toEqual([]);
	});

	it("rejects a request without a file field", async () => {
		const { enqueue } = recordingEnqueue();
		const res = await handleUploadRequest(
			uploadRequest(await fixtures.epub3(), "a.epub", "other"),
			deps(enqueue),
		);
		expect(res.status).toBe(400);
	});

	it("maps duplicate bytes to the existing edition as an additional source", async () => {
		const bytes = await fixtures.epub2();
		const sha256 = sha256Of(bytes);
		const { calls, enqueue } = recordingEnqueue();
		const first = await (
			await handleUploadRequest(uploadRequest(bytes, "a.epub"), deps(enqueue))
		).json();
		await setEditionStatus(t.db, first.editionId, "ready");
		const res = await handleUploadRequest(
			uploadRequest(bytes, "copy.epub"),
			deps(enqueue),
		);
		expect(res.status).toBe(200);
		const second = await res.json();
		expect(second).toMatchObject({
			editionId: first.editionId,
			created: false,
			status: "ready",
		});
		expect(calls).toHaveLength(1);
		const files = await t.db
			.select()
			.from(libraryFiles)
			.where(eq(libraryFiles.sha256, sha256));
		expect(files.map((f) => f.relPath).sort()).toEqual([
			`${sha256}/a.epub`,
			`${sha256}/copy.epub`,
		]);
	});
});

describe("filesystem scan", () => {
	freshDb();
	let root: string;
	let dataDir: string;
	let hashes = 0;
	const { calls, enqueue } = recordingEnqueue();
	const scan = (full = false) =>
		scanLibraries(
			{
				db: t.db,
				libraryPaths: [root],
				enqueue,
				log: silentLog,
				hash: (f) => {
					hashes++;
					return hashFile(f);
				},
			},
			{ full },
		);
	const reset = () => {
		hashes = 0;
		calls.length = 0;
	};
	const rowFor = async (relPath: string) => {
		const rows = await t.db
			.select()
			.from(libraryFiles)
			.where(eq(libraryFiles.relPath, relPath));
		return rows[0];
	};

	beforeAll(async () => {
		root = await tempDataDir();
		dataDir = await tempDataDir();
		await mkdir(path.join(root, "shelf", "nested"), { recursive: true });
		await writeFile(
			path.join(root, "shelf", "nested", "book.epub"),
			await fixtures.epub3(),
		);
		await writeFile(path.join(root, "notes.txt"), "not a book");
	});

	it("hashes and enqueues a new file", async () => {
		reset();
		const stats = await scan();
		expect(stats).toMatchObject({ roots: 1, seen: 1, hashed: 1, enqueued: 1 });
		const sha256 = sha256Of(await fixtures.epub3());
		expect(calls).toEqual([{ kind: "library.ingest", payload: { sha256 } }]);
		expect(await rowFor("shelf/nested/book.epub")).toMatchObject({
			sha256,
			status: "available",
		});
		expect((await getEditionBySha(t.db, sha256))?.title).toBe("book");
	});

	it("reads and enqueues nothing when nothing changed", async () => {
		reset();
		const stats = await scan();
		expect(stats).toMatchObject({ seen: 1, hashed: 0, enqueued: 0 });
		expect(hashes).toBe(0);
		expect(calls).toEqual([]);
	});

	it("re-hashes everything on a full rescan", async () => {
		reset();
		await scan(true);
		expect(hashes).toBe(1);
	});

	it("ingests replaced content as a new edition associated with the path", async () => {
		const file = path.join(root, "shelf", "nested", "book.epub");
		const oldSha = sha256Of(await fixtures.epub3());
		const replacement = await fixtures.epub2();
		await writeFile(file, replacement);
		await utimes(file, new Date(), new Date(Date.now() + 5_000));
		reset();
		const stats = await scan();
		const newSha = sha256Of(replacement);
		expect(stats).toMatchObject({ hashed: 1, enqueued: 1 });
		expect(calls).toEqual([
			{ kind: "library.ingest", payload: { sha256: newSha } },
		]);
		expect((await rowFor("shelf/nested/book.epub"))?.sha256).toBe(newSha);
		expect(await getEditionBySha(t.db, newSha)).toBeTruthy();
		expect(await isEditionAvailable(t.db, oldSha)).toBe(false);
	});

	it("marks a deleted file missing; its edition is unavailable but still searchable", async () => {
		const file = path.join(root, "shelf", "nested", "book.epub");
		const bytes = await fixtures.epub2();
		const sha256 = sha256Of(bytes);
		await ingestEdition({ db: t.db, dataDir, log: silentLog }, sha256, {
			finalAttempt: true,
		});
		const edition = await getEditionBySha(t.db, sha256);
		const [before] = await t.db
			.select({ n: count() })
			.from(passages)
			.where(eq(passages.editionId, edition?.id as string));
		expect(before?.n).toBeGreaterThan(0);

		await rm(file);
		reset();
		const stats = await scan();
		expect(stats).toMatchObject({ missing: 1, enqueued: 0 });
		expect((await rowFor("shelf/nested/book.epub"))?.status).toBe("missing");
		expect(await isEditionAvailable(t.db, sha256)).toBe(false);
		expect((await getEditionBySha(t.db, sha256))?.status).toBe("ready");
		const [after] = await t.db
			.select({ n: count() })
			.from(passages)
			.where(eq(passages.editionId, edition?.id as string));
		expect(after?.n).toBe(before?.n);
	});

	it("marks a returning file available again without re-ingesting", async () => {
		const file = path.join(root, "shelf", "nested", "book.epub");
		const bytes = await fixtures.epub2();
		await writeFile(file, bytes);
		reset();
		const stats = await scan();
		expect(stats).toMatchObject({ enqueued: 0, missing: 0 });
		expect(calls).toEqual([]);
		expect((await rowFor("shelf/nested/book.epub"))?.status).toBe("available");
		expect(await isEditionAvailable(t.db, sha256Of(bytes))).toBe(true);
	});

	it("scans a read-only library without writing to it", async () => {
		const ro = await tempDataDir();
		await cp(root, ro, { recursive: true });
		await writeFile(
			path.join(ro, "shelf", "other.epub"),
			await fixtures.nestedToc(),
		);
		const snapshot = async () =>
			Promise.all(
				(await filesIn(ro)).map(async (f) => {
					const s = await stat(path.join(ro, f));
					return `${f}:${s.size}:${s.mtimeMs}`;
				}),
			);
		const lock = async (mode: "ro" | "rw") => {
			for (const f of await filesIn(ro)) {
				const p = path.join(ro, f);
				const isDir = (await stat(p)).isDirectory();
				await chmod(
					p,
					mode === "ro" ? (isDir ? 0o555 : 0o444) : isDir ? 0o755 : 0o644,
				);
			}
			await chmod(ro, mode === "ro" ? 0o555 : 0o755);
		};
		const before = await snapshot();
		await lock("ro");
		try {
			const stats = await scanLibraries({
				db: t.db,
				libraryPaths: [ro],
				enqueue,
				log: silentLog,
			});
			expect(stats).toMatchObject({ roots: 1, seen: 2, hashed: 2 });
			expect(await snapshot()).toEqual(before);
		} finally {
			await lock("rw");
		}
	});

	it.skipIf(process.platform === "win32")(
		"follows symlinks only within the root",
		async () => {
			const outside = await tempDataDir();
			await writeFile(
				path.join(outside, "secret.epub"),
				await fixtures.epub3(),
			);
			const linked = await tempDataDir();
			await mkdir(path.join(linked, "real"));
			await writeFile(
				path.join(linked, "real", "in.epub"),
				await fixtures.fragments(),
			);
			await symlink(path.join(linked, "real"), path.join(linked, "alias"));
			await symlink(outside, path.join(linked, "escape"));
			const stats = await scanLibraries({
				db: t.db,
				libraryPaths: [linked],
				enqueue,
				log: silentLog,
			});
			// The alias resolves to an already-visited directory; the outside file is never reached.
			expect(stats.seen).toBe(1);
		},
	);

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});
});

describe("deletion", () => {
	freshDb();
	let dataDir: string;
	const ingest = (sha256: string) =>
		ingestEdition({ db: t.db, dataDir, log: silentLog }, sha256, {
			finalAttempt: true,
		});
	const remove = (id: string) => deleteEdition(t.db, dataDir, id, silentLog);
	const exists = (file: string) =>
		stat(file).then(
			() => true,
			() => false,
		);
	const rowCount = async (
		table:
			| typeof sections
			| typeof passages
			| typeof tocEntries
			| typeof locatorAliases,
		editionId: string,
	) => {
		const [row] = await t.db
			.select({ n: count() })
			.from(table)
			.where(eq(table.editionId, editionId));
		return row?.n;
	};
	const isExcluded = async (sha256: string) =>
		(
			await t.db
				.select()
				.from(excludedEditions)
				.where(eq(excludedEditions.sha256, sha256))
		).length === 1;

	beforeAll(async () => {
		dataDir = await tempDataDir();
	});

	it("removes an uploaded edition's data, upload rows, EPUB, and cover", async () => {
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.epub3(),
		);
		await ingest(sha256);
		const ready = await getEdition(t.db, edition.id);
		expect(ready?.status).toBe("ready");
		expect(ready?.coverPath).toBeTruthy();
		const cover = path.join(dataDir, ready?.coverPath as string);
		expect(await exists(cover)).toBe(true);
		expect(await rowCount(passages, edition.id)).toBeGreaterThan(0);

		expect(await remove(edition.id)).toEqual({ deleted: true });

		expect(await getEdition(t.db, edition.id)).toBeUndefined();
		for (const table of [sections, passages, tocEntries, locatorAliases]) {
			expect(await rowCount(table, edition.id)).toBe(0);
		}
		const [notes] = await t.db.select({ n: count() }).from(noteRefs);
		expect(notes?.n).toBe(0);
		expect(
			await t.db
				.select()
				.from(libraryFiles)
				.where(eq(libraryFiles.sha256, sha256)),
		).toEqual([]);
		expect(await exists(uploadedBookPath(dataDir, sha256))).toBe(false);
		expect(await exists(cover)).toBe(false);
		expect(await isExcluded(sha256)).toBe(true);
		expect(await listEditions(t.db)).toEqual([]);
	});

	it("deletes a failed import", async () => {
		const { edition } = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.drm(),
		);
		await setEditionStatus(t.db, edition.id, "failed", "DRM");
		expect(await remove(edition.id)).toEqual({ deleted: true });
		expect(await listEditions(t.db)).toEqual([]);
	});

	it("reports an unknown or already deleted edition as not found and changes nothing", async () => {
		const { edition } = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.verse(),
		);
		const missing = "00000000-0000-0000-0000-000000000000";
		expect(await remove(missing)).toEqual({
			deleted: false,
			reason: "not_found",
		});
		expect(await getEdition(t.db, edition.id)).toBeTruthy();
		expect(await remove(edition.id)).toEqual({ deleted: true });
		expect(await remove(edition.id)).toEqual({
			deleted: false,
			reason: "not_found",
		});
	});

	describe("with a library directory", () => {
		let root: string;
		let bytes: Buffer;
		let sha256: string;
		const file = () => path.join(root, "book.epub");
		const scan = (full = false) => {
			const { calls, enqueue } = recordingEnqueue();
			return scanLibraries(
				{ db: t.db, libraryPaths: [root], enqueue, log: silentLog },
				{ full },
			).then((stats) => ({ stats, calls }));
		};

		beforeAll(async () => {
			root = await tempDataDir();
			bytes = await fixtures.epub2();
			sha256 = sha256Of(bytes);
			await writeFile(file(), bytes);
			await scan();
			await ingest(sha256);
		});
		afterAll(async () => {
			await rm(root, { recursive: true, force: true });
		});

		it("leaves the library file and its row untouched", async () => {
			const before = await stat(file());
			const edition = await getEditionBySha(t.db, sha256);
			expect(edition?.status).toBe("ready");
			expect(await remove(edition?.id as string)).toEqual({ deleted: true });
			expect(await readFile(file())).toEqual(bytes);
			expect((await stat(file())).mtimeMs).toBe(before.mtimeMs);
			expect(
				await t.db
					.select({ relPath: libraryFiles.relPath })
					.from(libraryFiles)
					.where(eq(libraryFiles.sha256, sha256)),
			).toEqual([{ relPath: "book.epub" }]);
		});

		it("skips the excluded bytes on incremental and full scans", async () => {
			const incremental = await scan();
			expect(incremental.stats).toMatchObject({ hashed: 0, enqueued: 0 });
			const full = await scan(true);
			expect(full.stats).toMatchObject({
				hashed: 1,
				excluded: 1,
				enqueued: 0,
			});
			expect(full.calls).toEqual([]);
			expect(await getEditionBySha(t.db, sha256)).toBeUndefined();
		});

		it("skips a copy of the excluded bytes at a new path", async () => {
			await writeFile(path.join(root, "copy.epub"), bytes);
			const { stats, calls } = await scan();
			expect(stats).toMatchObject({ hashed: 1, excluded: 1, enqueued: 0 });
			expect(calls).toEqual([]);
			expect(await getEditionBySha(t.db, sha256)).toBeUndefined();
		});

		it("re-imports on upload and lists the library copies as sources", async () => {
			const { calls, enqueue } = recordingEnqueue();
			const res = await handleUploadRequest(uploadRequest(bytes, "back.epub"), {
				db: t.db,
				dataDir,
				maxUploadMb: 10,
				enqueue,
				log: silentLog,
			});
			expect(res.status).toBe(201);
			const { editionId } = await res.json();
			expect(await isExcluded(sha256)).toBe(false);
			expect(calls).toEqual([{ kind: "library.ingest", payload: { sha256 } }]);
			expect((await getEdition(t.db, editionId))?.status).toBe("processing");
			expect(await exists(uploadedBookPath(dataDir, sha256))).toBe(true);
			const detail = await getEditionDetail(t.db, editionId);
			expect(
				detail?.sources.filter((s) => s.kind === "filesystem"),
			).toHaveLength(2);
			const later = await scan();
			expect(later.stats).toMatchObject({ excluded: 0, enqueued: 0 });
		});
	});
});

describe("library actions", () => {
	freshDb();
	let runtime: JobRuntime;
	const queued = async (kind: JobKind) => runtime.boss.findJobs(kind);

	beforeAll(async () => {
		runtime = await JobRuntime.start({
			connectionString: t.url,
			config: { ingestConcurrency: 1 },
			log: silentLog,
			worker: false,
			handlers: {},
		});
	});
	afterAll(async () => {
		await runtime.stop(1_000);
	});

	it("enqueues one deduplicated scan for repeated rescan requests", async () => {
		expect(await requestRescan(runtime.enqueue)).toEqual({ enqueued: true });
		expect(await requestRescan(runtime.enqueue, { full: true })).toEqual({
			enqueued: false,
		});
		const jobs = await queued("library.scan");
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.data).toEqual({ full: false });
	});

	it("re-enqueues a failed import once, setting it back to processing", async () => {
		const dataDir = await tempDataDir();
		const { sha256, edition } = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.drm(),
			"drm2.epub",
		);
		await setEditionStatus(
			t.db,
			edition.id,
			"failed",
			"DRM-protected content is not supported",
		);
		expect(await retryImport(t.db, runtime.enqueue, edition.id)).toEqual({
			enqueued: true,
		});
		expect((await getEdition(t.db, edition.id))?.status).toBe("processing");
		await setEditionStatus(t.db, edition.id, "failed", "again");
		expect(await retryImport(t.db, runtime.enqueue, edition.id)).toEqual({
			enqueued: false,
		});
		const jobs = (await queued("library.ingest")).filter(
			(j) => (j.data as { sha256: string }).sha256 === sha256,
		);
		expect(jobs).toHaveLength(1);
		expect(
			await retryImport(
				t.db,
				runtime.enqueue,
				"00000000-0000-0000-0000-000000000000",
			),
		).toMatchObject({
			enqueued: false,
			reason: "not_found",
		});
	});

	it("enqueues reparse jobs only for outdated ready editions, deduplicated", async () => {
		const dataDir = await tempDataDir();
		const outdated = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.verse(),
			"old.epub",
		);
		const current = await addUploadedBook(
			t.db,
			dataDir,
			await fixtures.footnotes(),
			"new.epub",
		);
		await t.db
			.update(editions)
			.set({ status: "ready", parserVersion: PARSER_VERSION - 1 })
			.where(eq(editions.id, outdated.edition.id));
		await t.db
			.update(editions)
			.set({ status: "ready", parserVersion: PARSER_VERSION })
			.where(eq(editions.id, current.edition.id));

		const first = await reparseOutdated(t.db, runtime.enqueue, PARSER_VERSION);
		expect(first).toEqual({ outdated: 1, enqueued: 1 });
		const again = await reparseOutdated(
			t.db,
			runtime.enqueue,
			PARSER_VERSION,
			outdated.edition.id,
		);
		expect(again).toEqual({ outdated: 1, enqueued: 0 });
		const jobs = await queued("catalog.reparse");
		expect(jobs.map((j) => j.data)).toEqual([
			{ editionId: outdated.edition.id },
		]);
	});
});
