import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	EpubError,
	PARSER_VERSION,
	type ParsedCover,
	type ParsedEdition,
	parseEpub,
} from "#/modules/epub";
import {
	findReadableFile,
	getEdition,
	getEditionBySha,
	removeUnlessReimported,
	setEditionStatus,
} from "#/modules/library";
import type { Database } from "#/server/db";
import { NonRetryableError } from "#/server/jobs/kinds";
import type { Logger } from "#/server/logger";
import { type ReplacedHook, replaceEditionStructure } from "./persist";
import { resolveSearchConfig } from "./search-config";

export interface IngestDeps {
	db: Database;
	dataDir: string;
	log: Pick<Logger, "info" | "warn">;
	/** Overridable for tests (e.g. to simulate another parser version). */
	parse?: (file: string, fileName: string) => Promise<ParsedEdition>;
	/** The parser version currently in force; defaults to PARSER_VERSION. */
	parserVersion?: number;
	batchSize?: number;
	/** Re-anchors dependents (conversation bounds) inside a reparse's transaction. */
	onReplaced?: ReplacedHook;
	/** Called after a successful ingest or reparse (e.g. to enqueue preprocessing). Failures are logged, not thrown. */
	onIngested?: (editionId: string) => Promise<void>;
}

/** `deleted`: the edition was deleted before or during ingestion; nothing was written. */
export type IngestOutcome = "ready" | "unchanged" | "deleted";

/**
 * The `library.ingest` handler. Parses the edition's bytes and replaces its
 * structure in one transaction. A no-op when the edition is already ready at
 * the current parser version. Corrupt or DRM-protected files fail
 * immediately; other failures mark the edition failed on the final attempt.
 */
export async function ingestEdition(
	deps: IngestDeps,
	sha256: string,
	ctx: { finalAttempt: boolean },
): Promise<IngestOutcome> {
	const { db } = deps;
	const parserVersion = deps.parserVersion ?? PARSER_VERSION;
	const edition = await getEditionBySha(db, sha256);
	if (!edition) {
		deps.log.info({ sha256 }, "edition was deleted; skipping ingest");
		return "deleted";
	}
	if (edition.status === "ready" && edition.parserVersion === parserVersion) {
		return "unchanged";
	}

	try {
		const file = await findReadableFile(db, deps.dataDir, sha256);
		if (!file) {
			throw new NonRetryableError(
				"The EPUB file is no longer available in any library source",
			);
		}
		const parse = deps.parse ?? ((p, fileName) => parseEpub(p, { fileName }));
		const parsed = await parse(file.path, file.fileName);
		const coverPath = parsed.cover
			? await saveCover(deps.dataDir, sha256, parsed.cover)
			: null;
		const searchConfig = await resolveSearchConfig(
			db,
			parsed.metadata.language,
		);

		const written = await db.transaction((tx) =>
			replaceEditionStructure(tx, edition, parsed, {
				searchConfig,
				coverPath,
				batchSize: deps.batchSize,
				onReplaced: deps.onReplaced,
			}),
		);
		if (!written) {
			if (coverPath) {
				await removeUnlessReimported(
					db,
					sha256,
					[path.join(deps.dataDir, coverPath)],
					deps.log,
				);
			}
			deps.log.info(
				{ editionId: edition.id },
				"edition was deleted during ingest; nothing written",
			);
			return "deleted";
		}
		deps.log.info(
			{
				editionId: edition.id,
				title: parsed.metadata.title,
				warnings: parsed.warnings,
			},
			"edition ingested",
		);
		try {
			await deps.onIngested?.(edition.id);
		} catch (err) {
			deps.log.warn({ editionId: edition.id, err }, "post-ingest hook failed");
		}
		return "ready";
	} catch (err) {
		const permanent =
			err instanceof EpubError || err instanceof NonRetryableError;
		const reason =
			err instanceof Error ? err.message : `Import failed: ${String(err)}`;
		// A failed reparse leaves the previous (ready) structure in place.
		if ((permanent || ctx.finalAttempt) && edition.status !== "ready") {
			await setEditionStatus(db, edition.id, "failed", reason);
		}
		deps.log.warn(
			{ editionId: edition.id, err, permanent },
			"edition ingest failed",
		);
		if (err instanceof EpubError)
			throw new NonRetryableError(err.message, { cause: err });
		throw err;
	}
}

/** The `catalog.reparse` handler: re-ingests an edition parsed with an older parser version. */
export async function reparseEdition(
	deps: IngestDeps,
	editionId: string,
	ctx: { finalAttempt: boolean },
): Promise<IngestOutcome> {
	const edition = await getEdition(deps.db, editionId);
	if (!edition) {
		deps.log.info({ editionId }, "edition was deleted; skipping reparse");
		return "deleted";
	}
	return ingestEdition(deps, edition.sha256, ctx);
}

const COVER_EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/avif": "avif",
};

/** Writes the cover under `<dataDir>/covers` atomically; returns its path relative to dataDir. */
async function saveCover(dataDir: string, sha256: string, cover: ParsedCover) {
	const ext = COVER_EXTENSIONS[cover.mediaType];
	if (!ext) return null;
	const relative = `covers/${sha256}.${ext}`;
	const target = path.join(dataDir, relative);
	await mkdir(path.dirname(target), { recursive: true });
	const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
	await writeFile(temp, cover.data);
	await rename(temp, target);
	return relative;
}
