import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "#/server/db";
import { type EditionStatus, editions, libraryFiles } from "./schema";

export type Edition = typeof editions.$inferSelect;

/** Short-id lengths tried in turn when a prefix collides with another edition. */
const SHORT_ID_LENGTHS = [12, 16, 20, 32, 64];

/**
 * Returns the edition for these bytes, creating it (status `processing`) if
 * needed. `provisionalTitle` is shown until ingestion reads the real title.
 */
export async function ensureEdition(
	db: Executor,
	sha256: string,
	provisionalTitle: string,
): Promise<{ edition: Edition; created: boolean }> {
	const existing = await getEditionBySha(db, sha256);
	if (existing) return { edition: existing, created: false };
	for (const length of SHORT_ID_LENGTHS) {
		const [row] = await db
			.insert(editions)
			.values({
				sha256,
				shortId: sha256.slice(0, length),
				title: provisionalTitle,
			})
			.onConflictDoNothing()
			.returning();
		if (row) return { edition: row, created: true };
		// Either another process inserted the same sha256, or the short id collided.
		const raced = await getEditionBySha(db, sha256);
		if (raced) return { edition: raced, created: false };
	}
	throw new Error(`Could not allocate a short id for ${sha256}`);
}

export async function getEditionBySha(db: Executor, sha256: string) {
	const [row] = await db
		.select()
		.from(editions)
		.where(eq(editions.sha256, sha256));
	return row;
}

export async function getEdition(db: Executor, id: string) {
	const [row] = await db.select().from(editions).where(eq(editions.id, id));
	return row;
}

export async function getEditionByShortId(db: Executor, shortId: string) {
	const [row] = await db
		.select()
		.from(editions)
		.where(eq(editions.shortId, shortId));
	return row;
}

export interface ReadyFields {
	title: string;
	authors: string[];
	language: string | null;
	publisher: string | null;
	published: string | null;
	identifiers: { scheme: string | null; value: string }[];
	description: string | null;
	coverPath: string | null;
	epubVersion: string;
	parserVersion: number;
	linearPassageCount: number;
	searchConfig: string;
}

/** Called by the catalog inside the transaction that writes the edition's structure. */
export async function markEditionReady(
	db: Executor,
	id: string,
	fields: ReadyFields,
) {
	await db
		.update(editions)
		.set({ ...fields, status: "ready", error: null, updatedAt: sql`now()` })
		.where(eq(editions.id, id));
}

export async function setEditionStatus(
	db: Executor,
	id: string,
	status: EditionStatus,
	error: string | null = null,
) {
	await db
		.update(editions)
		.set({ status, error, updatedAt: sql`now()` })
		.where(eq(editions.id, id));
}

/** Whether any library source still has an available copy of the edition's bytes. */
export async function isEditionAvailable(db: Executor, sha256: string) {
	const [row] = await db
		.select({ id: libraryFiles.id })
		.from(libraryFiles)
		.where(
			and(
				eq(libraryFiles.sha256, sha256),
				eq(libraryFiles.status, "available"),
			),
		)
		.limit(1);
	return row !== undefined;
}
