import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { getReadingUnits, type Rebase } from "#/modules/catalog";
import { editions } from "#/modules/library";
import type { Database, Executor } from "#/server/db";
import { readingPositions } from "./schema";

/**
 * How far the reader has read: a reading unit, by its end position and
 * label, or the whole book. An edition without one is unset.
 */
export type ReadingPosition =
	| { kind: "finished" }
	| { kind: "unit"; maxPosition: number; scopeLabel: string };

/** A position the reader chose: a unit by its end position, or the whole book. */
export type PositionChoice =
	| { kind: "whole" }
	| { kind: "unit"; endPosition: number };

export type SetPositionResult =
	| { set: true; position: ReadingPosition }
	| {
			set: false;
			/**
			 * `move_back`: the choice is earlier than the stored position and
			 * `moveBack` was not given. `stale_scope`: the unit is no longer one
			 * of the edition's units.
			 */
			reason: "not_found" | "stale_scope" | "move_back";
	  };

const toPosition = (row: {
	maxPosition: number | null;
	scopeLabel: string | null;
}): ReadingPosition =>
	row.maxPosition === null
		? { kind: "finished" }
		: {
				kind: "unit",
				maxPosition: row.maxPosition,
				scopeLabel: row.scopeLabel as string,
			};

/** The edition's reading position, or null when it is unset. */
export async function getReadingPosition(
	db: Executor,
	editionId: string,
): Promise<ReadingPosition | null> {
	const [row] = await db
		.select({
			maxPosition: readingPositions.maxPosition,
			scopeLabel: readingPositions.scopeLabel,
		})
		.from(readingPositions)
		.where(eq(readingPositions.editionId, editionId));
	return row ? toPosition(row) : null;
}

/**
 * Sets a ready edition's reading position, validated against its current
 * reading units; the label comes from the server-side unit. A later unit or
 * finished applies at once. An earlier unit applies only with `moveBack`:
 * the forward-only check is part of the upsert, so a concurrent advance is
 * never undone by a move back the reader did not confirm.
 */
export async function setReadingPosition(
	db: Database,
	editionId: string,
	choice: PositionChoice,
	options: { moveBack?: boolean } = {},
): Promise<SetPositionResult> {
	return db.transaction(async (tx) => {
		// Conflicts with the lock replaceEditionStructure takes, so units cannot change before the write.
		const [edition] = await tx
			.select({ status: editions.status })
			.from(editions)
			.where(eq(editions.id, editionId))
			.for("share");
		if (!edition || edition.status !== "ready")
			return { set: false, reason: "not_found" } as const;
		let values = { maxPosition: null, scopeLabel: null } as {
			maxPosition: number | null;
			scopeLabel: string | null;
		};
		if (choice.kind === "unit") {
			const units = await getReadingUnits(tx, editionId);
			const unit = units.find((u) => u.endPosition === choice.endPosition);
			if (!unit) return { set: false, reason: "stale_scope" } as const;
			values = { maxPosition: unit.endPosition, scopeLabel: unit.label };
		}
		const forward =
			values.maxPosition === null
				? undefined
				: and(
						isNotNull(readingPositions.maxPosition),
						lte(readingPositions.maxPosition, values.maxPosition),
					);
		const rows = await tx
			.insert(readingPositions)
			.values({ editionId, ...values })
			.onConflictDoUpdate({
				target: readingPositions.editionId,
				set: { ...values, updatedAt: sql`now()` },
				setWhere: options.moveBack ? undefined : forward,
			})
			.returning({
				maxPosition: readingPositions.maxPosition,
				scopeLabel: readingPositions.scopeLabel,
			});
		const [row] = rows;
		if (!row) return { set: false, reason: "move_back" } as const;
		return { set: true, position: toPosition(row) } as const;
	});
}

/** Clears the edition's reading position back to unset. Returns whether one was set. */
export async function clearReadingPosition(
	db: Executor,
	editionId: string,
): Promise<boolean> {
	const rows = await db
		.delete(readingPositions)
		.where(eq(readingPositions.editionId, editionId))
		.returning({ editionId: readingPositions.editionId });
	return rows.length > 0;
}

/**
 * Re-anchors the edition's reading position after a reparse (design D2): a
 * bound, so it follows `rebase` and never moves later than the text it
 * covered. Runs inside the reparse's transaction; the label is kept.
 */
export async function rebaseReadingPositions(
	tx: Executor,
	editionId: string,
	rebase: Rebase,
): Promise<void> {
	const [row] = await tx
		.select({ maxPosition: readingPositions.maxPosition })
		.from(readingPositions)
		.where(eq(readingPositions.editionId, editionId));
	// Unset and finished positions have no bound to move.
	if (!row || row.maxPosition === null) return;
	const next = rebase(row.maxPosition);
	if (next === row.maxPosition) return;
	await tx
		.update(readingPositions)
		.set({ maxPosition: next })
		.where(eq(readingPositions.editionId, editionId));
}
