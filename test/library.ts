import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pino } from "pino";
import { ingestEdition } from "#/modules/catalog";
import type {
	ParsedEdition,
	ParsedPassage,
	ParsedTocEntry,
} from "#/modules/epub";
import {
	booksDir,
	ensureEdition,
	ensureSource,
	recordFile,
	uploadedBookPath,
	uploadRelPath,
} from "#/modules/library";
import type { Database } from "#/server/db";

export const silentLog = pino({ level: "silent" });

export async function tempDataDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "marginalia-data-"));
}

export const sha256Of = (bytes: Buffer) =>
	createHash("sha256").update(bytes).digest("hex");

/** Stores bytes as an uploaded book and registers its edition (status `processing`). */
export async function addUploadedBook(
	db: Database,
	dataDir: string,
	bytes: Buffer,
	fileName = "book.epub",
) {
	const sha256 = sha256Of(bytes);
	await mkdir(booksDir(dataDir), { recursive: true });
	await writeFile(uploadedBookPath(dataDir, sha256), bytes);
	const source = await ensureSource(db, "upload", booksDir(dataDir));
	await recordFile(db, {
		sourceId: source.id,
		relPath: uploadRelPath(sha256, fileName),
		size: bytes.length,
		mtime: new Date(),
		sha256,
	});
	const { edition } = await ensureEdition(
		db,
		sha256,
		fileName.replace(/\.epub$/i, ""),
	);
	return { sha256, edition };
}

type SectionEdit = (
	passages: ParsedPassage[],
	spineIndex: number,
) => ParsedPassage[];

/**
 * Simulates another parser version's output: applies `edit` to each
 * section's passages, renumbers blocks and positions, and remaps note links
 * and TOC targets by passage identity (links to dropped passages are removed;
 * TOC targets fall back to the section's first passage).
 */
export function reshape(
	parsed: ParsedEdition,
	parserVersion: number,
	edit: SectionEdit,
): ParsedEdition {
	const remap = new Map<
		ParsedPassage,
		{ spineIndex: number; blockIndex: number }
	>();
	let position = 0;
	const sections = parsed.sections.map((section) => {
		const edited = edit(section.passages, section.spineIndex).map(
			(p, blockIndex) => {
				const next = {
					...p,
					spineIndex: section.spineIndex,
					blockIndex,
					position: section.linear ? ++position : null,
					revealPosition: section.linear ? position : p.revealPosition,
				};
				remap.set(p, { spineIndex: section.spineIndex, blockIndex });
				return next;
			},
		);
		return { ...section, passages: edited };
	});
	const passageAt = (ref: { spineIndex: number; blockIndex: number }) =>
		parsed.sections[ref.spineIndex]?.passages[ref.blockIndex] as ParsedPassage;
	const moved = (ref: { spineIndex: number; blockIndex: number }) =>
		remap.get(passageAt(ref));
	const toc = (entries: ParsedTocEntry[]): ParsedTocEntry[] =>
		entries.map((e) => ({
			...e,
			target: e.target
				? (moved(e.target) ??
					(sections[e.target.spineIndex]?.passages.length
						? { spineIndex: e.target.spineIndex, blockIndex: 0 }
						: null))
				: null,
			children: toc(e.children),
		}));
	return {
		...parsed,
		parserVersion,
		sections,
		toc: toc(parsed.toc),
		noteRefs: parsed.noteRefs.flatMap((r) => {
			const from = moved(r.from);
			const to = moved(r.to);
			return from && to ? [{ from, to }] : [];
		}),
		linearPassageCount: position,
	};
}

/** Uploads bytes and ingests them as a ready edition. */
export async function ingestBook(
	db: Database,
	dataDir: string,
	bytes: Buffer,
	name: string,
	over: Partial<Parameters<typeof ingestEdition>[0]> = {},
) {
	const { sha256, edition } = await addUploadedBook(db, dataDir, bytes, name);
	await ingestEdition({ db, dataDir, log: silentLog, ...over }, sha256, {
		finalAttempt: true,
	});
	return { id: edition.id, shortId: edition.shortId, sha256 };
}
