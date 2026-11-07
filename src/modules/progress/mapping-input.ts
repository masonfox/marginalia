import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { getReadingUnits, passages } from "#/modules/catalog";
import type { Executor } from "#/server/db";
import type { MappingInput } from "./mapping";

/** Loads what `mapReading` needs for an edition: its units and linear passages. */
export async function loadMappingInput(
	db: Executor,
	editionId: string,
): Promise<MappingInput> {
	const [units, rows] = await Promise.all([
		getReadingUnits(db, editionId),
		db
			.select({
				position: passages.position,
				spineIndex: passages.spineIndex,
				chars: sql<number>`char_length(${passages.text})::int`,
			})
			.from(passages)
			.where(
				and(eq(passages.editionId, editionId), isNotNull(passages.position)),
			)
			.orderBy(asc(passages.position)),
	]);
	return {
		units: units.map((u) => ({ endPosition: u.endPosition, label: u.label })),
		passages: rows.map((r) => ({ ...r, position: r.position as number })),
	};
}
