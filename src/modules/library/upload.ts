import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import busboy from "busboy";
import { EpubError, validateEpubContainer } from "#/modules/epub";
import type { Database } from "#/server/db";
import { publicOrigin } from "#/server/health";
import type { Enqueue } from "#/server/jobs/kinds";
import type { Logger } from "#/server/logger";
import { ensureEdition } from "./editions";
import {
	booksDir,
	ensureSource,
	recordFile,
	uploadedBookPath,
	uploadRelPath,
} from "./files";

export interface UploadDeps {
	db: Database;
	dataDir: string;
	maxUploadMb: number;
	/** MARGINALIA_PUBLIC_URL, for the absolute Location of a created edition. */
	publicUrl?: string;
	enqueue: Enqueue;
	log: Pick<Logger, "info" | "warn">;
}

export interface UploadResult {
	editionId: string;
	/** False when identical bytes were already in the library. */
	created: boolean;
	status: string;
}

export class UploadError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "UploadError";
	}
}

/**
 * Handles a multipart upload with a single `file` field. The file streams to
 * a temp file while being hashed, with the size limit enforced during
 * streaming; it is validated as an EPUB container and then atomically renamed
 * to its content-addressed path. Nothing is kept when any step fails.
 */
export async function handleUploadRequest(
	request: Request,
	deps: UploadDeps,
): Promise<Response> {
	try {
		const result = await storeUpload(request, deps);
		const location = `${publicOrigin(request, deps.publicUrl)}/books/${result.editionId}`;
		return Response.json(result, {
			status: result.created ? 201 : 200,
			headers: { location },
		});
	} catch (err) {
		if (err instanceof UploadError) {
			return Response.json({ error: err.message }, { status: err.status });
		}
		deps.log.warn({ err }, "upload failed");
		return Response.json(
			{ error: "The upload failed. Please try again." },
			{ status: 500 },
		);
	}
}

export function uploadLimitMessage(maxUploadMb: number) {
	return `The file is larger than the ${maxUploadMb} MB upload limit.`;
}

async function storeUpload(
	request: Request,
	deps: UploadDeps,
): Promise<UploadResult> {
	const maxBytes = deps.maxUploadMb * 1024 * 1024;
	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.startsWith("multipart/form-data") || !request.body) {
		throw new UploadError(
			400,
			"Send the EPUB as multipart/form-data in a field named “file”.",
		);
	}
	const declared = Number(request.headers.get("content-length") ?? 0);
	// Allow some room for multipart framing before rejecting on the header alone.
	if (declared > maxBytes + 64 * 1024) {
		throw new UploadError(413, uploadLimitMessage(deps.maxUploadMb));
	}

	const tmpDir = path.join(deps.dataDir, "tmp");
	await mkdir(tmpDir, { recursive: true });
	const tempPath = path.join(tmpDir, `${randomBytes(12).toString("hex")}.part`);
	try {
		const received = await receiveFile(
			request,
			contentType,
			tempPath,
			maxBytes,
		);
		try {
			await validateEpubContainer(tempPath);
		} catch (err) {
			if (err instanceof EpubError) throw new UploadError(400, err.message);
			throw err;
		}
		return await commitUpload(deps, tempPath, received);
	} finally {
		await rm(tempPath, { force: true, maxRetries: 5 });
	}
}

interface ReceivedFile {
	sha256: string;
	size: number;
	fileName: string;
}

function receiveFile(
	request: Request,
	contentType: string,
	tempPath: string,
	maxBytes: number,
): Promise<ReceivedFile> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const fail = (err: Error) => {
			if (settled) return;
			settled = true;
			reject(err);
		};
		let filePromise: Promise<ReceivedFile> | null = null;
		const parser = busboy({
			headers: { "content-type": contentType },
			limits: { files: 1, fileSize: maxBytes, fields: 10, parts: 12 },
		});
		parser.on("file", (field, stream, info) => {
			if (field !== "file" || filePromise) {
				stream.resume();
				return;
			}
			const hash = createHash("sha256");
			let size = 0;
			const meter = new Transform({
				transform(chunk: Buffer, _enc, cb) {
					hash.update(chunk);
					size += chunk.length;
					cb(null, chunk);
				},
			});
			stream.on("limit", () => {
				// Abort the write; the pipeline rejects once the temp file is closed.
				meter.destroy(
					new UploadError(413, uploadLimitMessage(maxBytes / 1024 / 1024)),
				);
			});
			filePromise = pipeline(stream, meter, createWriteStream(tempPath)).then(
				() => ({
					sha256: hash.digest("hex"),
					size,
					fileName: info.filename || "upload.epub",
				}),
			);
			filePromise.catch(fail);
		});
		parser.on("error", (err) =>
			fail(err instanceof Error ? err : new Error(String(err))),
		);
		parser.on("close", () => {
			if (settled) return;
			if (!filePromise) {
				fail(
					new UploadError(
						400,
						"No file was uploaded (expected a field named “file”).",
					),
				);
				return;
			}
			filePromise.then((file) => {
				if (settled) return;
				settled = true;
				resolve(file);
			}, fail);
		});
		Readable.fromWeb(request.body as WebReadableStream<Uint8Array>)
			.on("error", fail)
			.pipe(parser);
	});
}

async function commitUpload(
	deps: UploadDeps,
	tempPath: string,
	file: ReceivedFile,
): Promise<UploadResult> {
	const { db } = deps;
	const target = uploadedBookPath(deps.dataDir, file.sha256);
	await mkdir(booksDir(deps.dataDir), { recursive: true });
	const exists = await stat(target).then(
		() => true,
		() => false,
	);
	if (!exists) await rename(tempPath, target);

	const source = await ensureSource(db, "upload", booksDir(deps.dataDir));
	await recordFile(db, {
		sourceId: source.id,
		relPath: uploadRelPath(file.sha256, file.fileName),
		size: file.size,
		mtime: new Date(),
		sha256: file.sha256,
	});
	const title =
		path.basename(file.fileName).replace(/\.epub$/i, "") || "Untitled";
	const { edition, created } = await ensureEdition(db, file.sha256, title);
	if (edition.status === "processing") {
		await deps.enqueue("library.ingest", { sha256: file.sha256 });
	}
	deps.log.info(
		{ editionId: edition.id, created, size: file.size },
		"upload stored",
	);
	return { editionId: edition.id, created, status: edition.status };
}
