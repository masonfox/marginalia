import { and, asc, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import {
	decodeShelfCursor,
	encodeShelfCursor,
	type ShelfCursor,
} from "#/lib/shelf-cursor";
import {
	ATTENTION_STATUSES,
	type ShelfFilter,
	type ShelfStatus,
} from "#/lib/shelf-status";
import { readingPositions } from "#/modules/guide";
import { editionAvailableSql, editions } from "#/modules/library";
import type { Executor } from "#/server/db";

export const SHELF_PAGE_SIZE = 60;

export interface ShelfItem {
	id: string;
	title: string;
	authors: string[];
	status: ShelfStatus;
	error: string | null;
	hasCover: boolean;
}

export interface ShelfPage {
	items: ShelfItem[];
	/** Opaque; pass back as `cursor` for the next page. Null after the last page. */
	nextCursor: string | null;
	/**
	 * Editions in the library. This and the other counts are computed only for
	 * the first page; pages fetched with a cursor return null counts.
	 */
	total: number | null;
	/** Editions matching the search and filter. */
	matching: number | null;
	/** Editions processing, failed, or unavailable, ignoring the search and filter. */
	needsAttention: number | null;
	/** Editions processing, ignoring the search and filter. */
	processing: number | null;
	/** Editions in each reading status, ignoring the search and filter. */
	statusCounts: StatusCounts | null;
}

/** Editions in each reading status, whatever the search and filter. */
export type StatusCounts = Record<
	"not-started" | "reading" | "finished",
	number
>;

export interface ShelfQuery {
	q?: string;
	status?: ShelfFilter;
	cursor?: string;
	limit?: number;
}

export class InvalidShelfCursorError extends Error {
	constructor() {
		super("Invalid library cursor");
		this.name = "InvalidShelfCursorError";
	}
}

/**
 * The single status shown on a book and matched by the filter. Defined once
 * so the badge and the filter cannot disagree.
 */
const statusSql = sql<ShelfStatus>`case
	when ${editions.status} = 'processing' then 'processing'
	when ${editions.status} = 'failed' then 'failed'
	when not ${editionAvailableSql} then 'unavailable'
	when ${readingPositions.editionId} is null then 'not-started'
	when ${readingPositions.maxPosition} is null then 'finished'
	else 'reading'
end`;

const sortTitleSql = sql<string>`lower(${editions.title})`;
/** created_at at full (microsecond) precision, which a JS Date would lose. */
const createdKeySql = sql<string>`to_char(${editions.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// --- Conditions -------------------------------------------------------------

/** Escapes LIKE wildcards so the text matches literally (backslash is the default escape). */
function likePattern(text: string): string {
	return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function searchCondition(q: string | undefined): SQL | undefined {
	const term = q?.trim();
	if (!term) return undefined;
	const pattern = likePattern(term);
	return or(
		sql`${editions.title} ilike ${pattern}`,
		sql`exists (
			select 1 from jsonb_array_elements_text(${editions.authors}) as author(name)
			where author.name ilike ${pattern}
		)`,
	);
}

function filterCondition(status: ShelfFilter | undefined): SQL | undefined {
	if (!status) return undefined;
	if (status === "attention")
		return inArray(statusSql, [...ATTENTION_STATUSES]);
	return eq(statusSql, status);
}

/**
 * Count columns for each reading status. They never apply the search, so
 * the filter's counts stay put while the reader types.
 */
const statusCountColumns = {
	notStarted: sql<number>`(count(*) filter (where ${filterCondition("not-started")}))::int`,
	reading: sql<number>`(count(*) filter (where ${filterCondition("reading")}))::int`,
	finished: sql<number>`(count(*) filter (where ${filterCondition("finished")}))::int`,
};

function statusCountsOf(
	row:
		| { notStarted: number; reading: number; finished: number }
		| null
		| undefined,
): StatusCounts {
	return {
		"not-started": row?.notStarted ?? 0,
		reading: row?.reading ?? 0,
		finished: row?.finished ?? 0,
	};
}

// --- Query ------------------------------------------------------------------

/**
 * One page of the library list in title order, with the search, the status
 * filter, and the counts the page shows. Paging is keyset on
 * (lower(title), created_at, id), so imports between pages never repeat a book.
 */
export async function listShelf(
	db: Executor,
	{ q, status, cursor, limit = SHELF_PAGE_SIZE }: ShelfQuery,
): Promise<ShelfPage> {
	let after: ShelfCursor | null = null;
	if (cursor !== undefined) {
		after = decodeShelfCursor(cursor);
		if (!after) throw new InvalidShelfCursorError();
	}
	const pageSize = Math.max(1, Math.min(Math.trunc(limit), 500));
	const match = and(searchCondition(q), filterCondition(status));
	const joined = eq(readingPositions.editionId, editions.id);

	const pageQuery = db
		.select({
			id: editions.id,
			title: editions.title,
			authors: editions.authors,
			status: statusSql,
			error: editions.error,
			coverPath: editions.coverPath,
			sortTitle: sortTitleSql,
			createdKey: createdKeySql,
		})
		.from(editions)
		.leftJoin(readingPositions, joined)
		.where(
			and(
				match,
				after
					? sql`(${sortTitleSql}, ${editions.createdAt}, ${editions.id}) > (${after.t}, ${after.c}::timestamptz, ${after.i}::uuid)`
					: undefined,
			),
		)
		.orderBy(sortTitleSql, asc(editions.createdAt), asc(editions.id))
		.limit(pageSize + 1);

	// Only the first page carries counts; the client reads them from pages[0].
	const countsQuery = db
		.select({
			total: sql<number>`count(*)::int`,
			matching: match
				? sql<number>`(count(*) filter (where ${match}))::int`
				: sql<number>`count(*)::int`,
			needsAttention: sql<number>`(count(*) filter (where ${inArray(statusSql, [...ATTENTION_STATUSES])}))::int`,
			processing: sql<number>`(count(*) filter (where ${editions.status} = 'processing'))::int`,
			...statusCountColumns,
		})
		.from(editions)
		.leftJoin(readingPositions, joined);

	const [rows, counts] = await Promise.all([
		pageQuery,
		after ? null : countsQuery.then(([row]) => row ?? null),
	]);
	const page = rows.slice(0, pageSize);
	const last = page.at(-1);
	return {
		items: page.map((r) => ({
			id: r.id,
			title: r.title,
			authors: r.authors,
			status: r.status,
			error: r.error,
			hasCover: r.coverPath !== null,
		})),
		nextCursor:
			rows.length > pageSize && last
				? encodeShelfCursor({
						t: last.sortTitle,
						c: last.createdKey,
						i: last.id,
					})
				: null,
		total: after ? null : (counts?.total ?? 0),
		matching: after ? null : (counts?.matching ?? 0),
		needsAttention: after ? null : (counts?.needsAttention ?? 0),
		processing: after ? null : (counts?.processing ?? 0),
		statusCounts: after ? null : statusCountsOf(counts),
	};
}

export interface ReadingShelfItem {
	id: string;
	title: string;
	authors: string[];
	hasCover: boolean;
	/** The reading position's label, such as "Chapter 3". */
	scopeLabel: string | null;
}

export interface ReadingShelf {
	items: ReadingShelfItem[];
	/** Editions in the library, whatever their status. */
	total: number;
	/** Editions in each reading status. */
	statusCounts: StatusCounts;
}

/**
 * The books being read (the list's Reading status), most recently updated
 * reading position first, with the library's edition count and its counts
 * per reading status. Never pages.
 */
export async function listReadingShelf(
	db: Executor,
	{ limit }: { limit: number },
): Promise<ReadingShelf> {
	const joined = eq(readingPositions.editionId, editions.id);
	const [rows, [counts]] = await Promise.all([
		db
			.select({
				id: editions.id,
				title: editions.title,
				authors: editions.authors,
				coverPath: editions.coverPath,
				scopeLabel: readingPositions.scopeLabel,
			})
			.from(editions)
			.leftJoin(readingPositions, joined)
			.where(eq(statusSql, "reading"))
			.orderBy(desc(readingPositions.updatedAt), asc(editions.id))
			.limit(Math.max(1, Math.min(Math.trunc(limit), 500))),
		db
			.select({ total: sql<number>`count(*)::int`, ...statusCountColumns })
			.from(editions)
			.leftJoin(readingPositions, joined),
	]);
	return {
		items: rows.map((r) => ({
			id: r.id,
			title: r.title,
			authors: r.authors,
			hasCover: r.coverPath !== null,
			scopeLabel: r.scopeLabel,
		})),
		total: counts?.total ?? 0,
		statusCounts: statusCountsOf(counts),
	};
}
