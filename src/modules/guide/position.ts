import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { getReadingUnits, type Rebase } from "#/modules/catalog";
import { editions } from "#/modules/library";
import type { ProviderKind, StoredReading } from "#/modules/progress";
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
		// A hand-set position is manual until a sync applies a new reading; the
		// link's last fingerprint is left alone (progress-sync design D5).
		const manual = {
			...values,
			source: "manual" as const,
			sourceReading: null,
			syncedAt: null,
			movedBackFrom: null,
		};
		const rows = await tx
			.insert(readingPositions)
			.values({ editionId, ...manual })
			.onConflictDoUpdate({
				target: readingPositions.editionId,
				set: { ...manual, updatedAt: sql`now()` },
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

/** Label recorded as `moved_back_from` when a sync moves back from finished. */
export const FINISHED_LABEL = "Finished";

/** A position applied by progress sync, and the reading that produced it. */
export interface SyncedPositionWrite {
	/** The mapped position; null is unset. */
	position: ReadingPosition | null;
	source: ProviderKind;
	sourceReading: StoredReading;
}

/**
 * Writes a position applied by progress sync, with no move-back
 * confirmation: the provider is the authority for synced books. Records the
 * source, the raw reading and the time, and `moved_back_from` (the previous
 * unit's label, or {@link FINISHED_LABEL}) when the new position is earlier.
 * An unset position deletes the row, since a row always means set, and
 * reports the deleted position as `movedBackFrom`; the caller keeps that on
 * the progress link, since no row is left to hold it. The
 * caller runs this in a transaction that holds the edition's share lock and
 * mapped `position` from the current reading units.
 */
export async function writeSyncedPosition(
	tx: Executor,
	editionId: string,
	write: SyncedPositionWrite,
): Promise<{ movedBackFrom: string | null }> {
	const { position } = write;
	if (position === null) {
		// Unset is earlier than any set position, so clearing one moves back.
		const [cleared] = await tx
			.delete(readingPositions)
			.where(eq(readingPositions.editionId, editionId))
			.returning({ scopeLabel: readingPositions.scopeLabel });
		return {
			movedBackFrom: cleared ? (cleared.scopeLabel ?? FINISHED_LABEL) : null,
		};
	}
	const [previous] = await tx
		.select({
			maxPosition: readingPositions.maxPosition,
			scopeLabel: readingPositions.scopeLabel,
		})
		.from(readingPositions)
		.where(eq(readingPositions.editionId, editionId))
		.for("update");
	const movedBackFrom = previous ? movedBackLabel(previous, position) : null;
	const values = {
		maxPosition: position.kind === "unit" ? position.maxPosition : null,
		scopeLabel: position.kind === "unit" ? position.scopeLabel : null,
		source: write.source,
		sourceReading: write.sourceReading,
		syncedAt: sql`now()`,
		movedBackFrom,
	};
	await tx
		.insert(readingPositions)
		.values({ editionId, ...values })
		.onConflictDoUpdate({
			target: readingPositions.editionId,
			set: { ...values, updatedAt: sql`now()` },
		});
	return { movedBackFrom };
}

/** The previous position's label when `next` is earlier than it, else null. */
function movedBackLabel(
	previous: { maxPosition: number | null; scopeLabel: string | null },
	next: ReadingPosition,
): string | null {
	if (previous.maxPosition === null)
		return next.kind === "finished" ? null : FINISHED_LABEL;
	if (next.kind === "unit" && next.maxPosition < previous.maxPosition)
		return previous.scopeLabel;
	return null;
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
