import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { editions } from "#/modules/library";
import type { Executor } from "#/server/db";

export const searchInput = z.object({
	/** Limit to one edition; omit to search every ready edition. */
	editionId: z.uuid().optional(),
	/**
	 * Limit to a set of editions, each with its own optional position bound.
	 * Ranking and the limit apply across the whole set. An empty set matches nothing.
	 */
	editionIds: z
		.array(
			z.object({
				editionId: z.uuid(),
				maxPosition: z.number().int().nonnegative().optional(),
			}),
		)
		.optional(),
	query: z.string().max(500),
	/** Only passages whose reveal position is at or before this bound. */
	maxPosition: z.number().int().nonnegative().optional(),
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),
});
export type SearchInput = z.input<typeof searchInput>;

export interface SnippetPart {
	text: string;
	match: boolean;
}

export interface SearchHit {
	locator: string;
	editionId: string;
	editionTitle: string;
	sectionTitle: string | null;
	kind: string;
	position: number | null;
	revealPosition: number;
	rank: number;
	snippet: SnippetPart[];
}

// Private-use characters delimit matches, so snippets never need HTML parsing.
const START = "";
const STOP = "";

/**
 * Full-text search over passages. Each edition is matched with its own text
 * search configuration via one constant `websearch_to_tsquery` per
 * configuration, so the GIN index applies. The position bound is part of the
 * WHERE clause, before ranking and LIMIT; snippets are computed only for the
 * returned page.
 */
export async function searchPassages(
	db: Executor,
	rawInput: SearchInput,
): Promise<SearchHit[]> {
	const input = searchInput.parse(rawInput);
	const query = input.query.trim();
	if (!query) return [];
	const scope = input.editionIds;
	if (scope && scope.length === 0) return [];

	const configRows = await db
		.selectDistinct({ config: editions.searchConfig })
		.from(editions)
		.where(
			and(
				eq(editions.status, "ready"),
				input.editionId ? eq(editions.id, input.editionId) : undefined,
				scope
					? inArray(
							editions.id,
							scope.map((e) => e.editionId),
						)
					: undefined,
			),
		);
	const configs = configRows
		.map((r) => r.config)
		.filter((c): c is string => Boolean(c));
	if (configs.length === 0) return [];

	const matchesAny = sql.join(
		configs.map(
			(c) =>
				sql`(p.search_config = ${c}::regconfig and p.tsv @@ websearch_to_tsquery(${c}::regconfig, ${query}))`,
		),
		sql` or `,
	);
	const filters: SQL[] = [sql`(${matchesAny})`];
	if (input.editionId) filters.push(sql`p.edition_id = ${input.editionId}`);
	if (scope) {
		filters.push(
			sql`(${sql.join(
				scope.map((e) =>
					e.maxPosition === undefined
						? sql`p.edition_id = ${e.editionId}`
						: sql`(p.edition_id = ${e.editionId} and p.reveal_position <= ${e.maxPosition})`,
				),
				sql` or `,
			)})`,
		);
	}
	if (input.maxPosition !== undefined) {
		filters.push(sql`p.reveal_position <= ${input.maxPosition}`);
	}

	const result = await db.execute<{
		locator: string;
		edition_id: string;
		edition_title: string;
		section_title: string | null;
		kind: string;
		position: number | null;
		reveal_position: number;
		rank: number;
		headline: string;
	}>(sql`
		with hits as (
			select p.id,
				ts_rank_cd(p.tsv, websearch_to_tsquery(p.search_config, ${query}), 32) as rank
			from passages p
			where ${sql.join(filters, sql` and `)}
			order by rank desc, p.edition_id, p.spine_index, p.block_index
			limit ${input.limit} offset ${input.offset}
		)
		select p.locator, p.edition_id, e.title as edition_title, s.title as section_title,
			p.kind, p.position, p.reveal_position, hits.rank,
			ts_headline(p.search_config, p.text, websearch_to_tsquery(p.search_config, ${query}),
				${`StartSel=${START}, StopSel=${STOP}, MaxWords=40, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "`}
			) as headline
		from hits
		join passages p on p.id = hits.id
		join sections s on s.id = p.section_id
		join editions e on e.id = p.edition_id
		order by hits.rank desc, p.edition_id, p.spine_index, p.block_index
	`);

	return result.rows.map((r) => ({
		locator: r.locator,
		editionId: r.edition_id,
		editionTitle: r.edition_title,
		sectionTitle: r.section_title,
		kind: r.kind,
		position: r.position,
		revealPosition: r.reveal_position,
		rank: Number(r.rank),
		snippet: splitHeadline(r.headline),
	}));
}

/** Turns marker-delimited headline text into plain/match parts (no HTML involved). */
function splitHeadline(headline: string): SnippetPart[] {
	const parts: SnippetPart[] = [];
	for (const [i, chunk] of headline.split(START).entries()) {
		if (i === 0) {
			if (chunk) parts.push({ text: chunk, match: false });
			continue;
		}
		const [matched, rest] = chunk.split(STOP) as [string, string | undefined];
		if (matched) parts.push({ text: matched, match: true });
		if (rest) parts.push({ text: rest, match: false });
	}
	return parts;
}
