// The reader's edits to corrections (design D5): replace, suppress, keep
// and remove. Machine rows are never touched; only the correction table
// changes.
import { and, eq, sql } from "drizzle-orm";
import {
	type DerivedCitation,
	listObservations,
	listSummaries,
} from "#/modules/analysis";
import type { ReadingUnit } from "#/modules/catalog";
import { editions } from "#/modules/library";
import { createRetrieval, verifyAgainst } from "#/modules/retrieval";
import type { Database, Executor } from "#/server/db";
import {
	correctionColumns,
	fingerprintOf,
	MAX_CITATION_QUOTE,
	MAX_CORRECTION_TEXT,
	observationText,
} from "./corrections";
import { getUnitAnchors, type UnitAnchors } from "./queries";
import { guideCorrections } from "./schema";

/**
 * The current machine text of a unit's summary, or of its observations of a
 * name key; null when the unit has no current row to correct.
 */
async function currentMachineText(
	db: Executor,
	editionId: string,
	anchors: UnitAnchors,
	unit: ReadingUnit,
	nameKey: string | null,
): Promise<string | null> {
	const inUnit = (row: { unitOrdinal: number; endPosition: number }) =>
		anchors.unitOf(row)?.ordinal === unit.ordinal;
	if (nameKey === null) {
		const rows = await listSummaries(db, editionId, unit.endPosition);
		return rows.find(inUnit)?.summary ?? null;
	}
	const rows = (
		await listObservations(db, editionId, unit.endPosition, [nameKey])
	).filter(inUnit);
	return rows.length > 0 ? observationText(rows.map((r) => r.note)) : null;
}

/** A citation the reader attaches: a passage and an exact quote from it. */
export interface CitationInput {
	locator: string;
	quote: string;
}

/**
 * Checks a reader's citation the way generated ones are checked (design D5):
 * only a passage of the corrected unit may be cited, and the quote is
 * verified against its stored text. Older locators are forwarded first.
 * Null when the passage is not one of the unit's: the citation is refused.
 */
async function verifyCitation(
	db: Executor,
	editionId: string,
	unit: ReadingUnit,
	citation: CitationInput,
): Promise<DerivedCitation | null> {
	const resolved = await createRetrieval(db).resolve(citation.locator);
	if (resolved.status !== "found" || resolved.edition.id !== editionId)
		return null;
	const { position } = resolved.passage;
	if (
		position === null ||
		position < unit.startPosition ||
		position > unit.endPosition
	)
		return null;
	const result = verifyAgainst(resolved, citation.quote);
	return {
		locator: resolved.currentLocator,
		quote: citation.quote.trim(),
		verified: result.status === "verified",
	};
}

/**
 * What a reader corrects: a unit's summary, or its observations of a name
 * key, replaced with the reader's text (and at most one citation) or
 * suppressed as wrong.
 */
export type CorrectionInput = {
	/** The unit's anchor: the locator of its first passage. */
	unitLocator: string;
} & (
	| { target: "summary"; nameKey?: null }
	| { target: "observation"; nameKey: string }
) &
	(
		| { action: "replace"; text: string; citation?: CitationInput | null }
		| { action: "suppress" }
	);

/**
 * A correction edit, or why it was refused. `not_found`: the edition is
 * missing or not ready, the unit anchor starts no current unit, or the
 * correction does not exist. `not_current`: the unit has no current machine
 * row to correct. `citation_outside_unit`: the cited passage is not one of
 * the corrected unit's. `invalid`: the text is empty or too long.
 */
export type CorrectionResult =
	| { ok: true; id: number; citation: DerivedCitation | null }
	| {
			ok: false;
			reason: "not_found" | "not_current" | "citation_outside_unit" | "invalid";
	  };

type Refusal = Extract<CorrectionResult, { ok: false }>;
const refuse = (reason: Refusal["reason"]): Refusal => ({ ok: false, reason });

/** Runs a correction edit with the edition locked against reparses and other edits. */
async function editCorrections(
	db: Database,
	editionId: string,
	edit: (tx: Executor, anchors: UnitAnchors) => Promise<CorrectionResult>,
): Promise<CorrectionResult> {
	return db.transaction(async (tx) => {
		const [edition] = await tx
			.select({ status: editions.status })
			.from(editions)
			.where(eq(editions.id, editionId))
			.for("update");
		if (!edition || edition.status !== "ready") return refuse("not_found");
		return edit(tx, await getUnitAnchors(tx, editionId));
	});
}

/**
 * Replaces or suppresses a unit's summary or its observations of a name.
 * One correction per item: saving again overwrites it. Records the
 * fingerprint of the machine text being corrected, so a later regeneration
 * is flagged.
 */
export async function saveCorrection(
	db: Database,
	editionId: string,
	input: CorrectionInput,
): Promise<CorrectionResult> {
	const nameKey = input.target === "observation" ? input.nameKey : null;
	const text = input.action === "replace" ? input.text.trim() : null;
	if (
		(nameKey !== null && nameKey.length === 0) ||
		(text !== null && (text.length === 0 || text.length > MAX_CORRECTION_TEXT))
	)
		return refuse("invalid");
	const cited = input.action === "replace" ? input.citation : null;
	if (cited && (!cited.quote.trim() || cited.quote.length > MAX_CITATION_QUOTE))
		return refuse("invalid");
	return editCorrections(db, editionId, async (tx, anchors) => {
		const unit = anchors.unitAt(input.unitLocator);
		if (!unit) return refuse("not_found");
		const machine = await currentMachineText(
			tx,
			editionId,
			anchors,
			unit,
			nameKey,
		);
		if (machine === null) return refuse("not_current");
		let citation: DerivedCitation | null = null;
		if (cited) {
			citation = await verifyCitation(tx, editionId, unit, cited);
			if (!citation) return refuse("citation_outside_unit");
		}
		const values = {
			action: input.action,
			text,
			citation,
			fingerprint: fingerprintOf(machine),
			detached: false,
			updatedAt: new Date(),
		};
		const [existing] = await tx
			.select({ id: guideCorrections.id })
			.from(guideCorrections)
			.where(
				and(
					eq(guideCorrections.editionId, editionId),
					eq(guideCorrections.target, input.target),
					eq(guideCorrections.unitLocator, unit.startLocator),
					sql`coalesce(${guideCorrections.nameKey}, '') = ${nameKey ?? ""}`,
				),
			);
		if (existing) {
			await tx
				.update(guideCorrections)
				.set(values)
				.where(eq(guideCorrections.id, existing.id));
			return { ok: true, id: existing.id, citation };
		}
		const [row] = await tx
			.insert(guideCorrections)
			.values({
				editionId,
				target: input.target,
				unitLocator: unit.startLocator,
				nameKey,
				...values,
			})
			.returning({ id: guideCorrections.id });
		return { ok: true, id: (row as { id: number }).id, citation };
	});
}

/**
 * Keeps a correction after its machine row was regenerated: acknowledges
 * the current machine text, which clears the "regenerated since" flag.
 */
export async function keepCorrection(
	db: Database,
	editionId: string,
	id: number,
): Promise<CorrectionResult> {
	return editCorrections(db, editionId, async (tx, anchors) => {
		const [correction] = await tx
			.select(correctionColumns)
			.from(guideCorrections)
			.where(
				and(
					eq(guideCorrections.editionId, editionId),
					eq(guideCorrections.id, id),
				),
			);
		if (!correction) return refuse("not_found");
		const unit = correction.detached
			? null
			: anchors.unitAt(correction.unitLocator);
		if (!unit) return refuse("not_current");
		const machine = await currentMachineText(
			tx,
			editionId,
			anchors,
			unit,
			correction.nameKey,
		);
		if (machine === null) return refuse("not_current");
		await tx
			.update(guideCorrections)
			.set({ fingerprint: fingerprintOf(machine), updatedAt: new Date() })
			.where(eq(guideCorrections.id, id));
		return { ok: true, id, citation: correction.citation };
	});
}

/** Removes a correction, restoring the machine row. False when there was none. */
export async function removeCorrection(
	db: Executor,
	editionId: string,
	id: number,
): Promise<boolean> {
	const removed = await db
		.delete(guideCorrections)
		.where(
			and(
				eq(guideCorrections.editionId, editionId),
				eq(guideCorrections.id, id),
			),
		)
		.returning({ id: guideCorrections.id });
	return removed.length > 0;
}
