// The reader's corrections (design D5): an overlay keyed by unit anchor and
// name key that replaces or suppresses current machine rows. The overlay's
// keys, fingerprints and loading; the merge itself is in queries.ts.
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DerivedCitation } from "#/modules/analysis";
import type { Executor } from "#/server/db";
import {
	type CorrectionAction,
	type CorrectionTarget,
	guideCorrections,
} from "./schema";

/** The longest replacement text a reader may write, in UTF-16 units. */
export const MAX_CORRECTION_TEXT = 10_000;
/** The longest quote a correction's citation may carry. */
export const MAX_CITATION_QUOTE = 1_000;

/** sha256 of a machine text: what a correction records having corrected. */
export function fingerprintOf(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * The machine text an observation correction covers: the unit's notes for
 * the name key, sorted and joined, so row order does not change it.
 */
export function observationText(notes: string[]): string {
	return [...notes].sort().join("\n");
}

/** The overlay key of a row or correction: unit anchor and, for observations, name key. */
export const correctionKey = (unitLocator: string, nameKey: string | null) =>
	`${unitLocator}\n${nameKey ?? ""}`;

/** A stored correction, as the merged view applies it. */
export interface CorrectionRecord {
	id: number;
	target: CorrectionTarget;
	unitLocator: string;
	nameKey: string | null;
	action: CorrectionAction;
	text: string | null;
	citation: DerivedCitation | null;
	fingerprint: string;
	detached: boolean;
}

export const correctionColumns = {
	id: guideCorrections.id,
	target: guideCorrections.target,
	unitLocator: guideCorrections.unitLocator,
	nameKey: guideCorrections.nameKey,
	action: guideCorrections.action,
	text: guideCorrections.text,
	citation: guideCorrections.citation,
	fingerprint: guideCorrections.fingerprint,
	detached: guideCorrections.detached,
};

/**
 * The edition's attached corrections of one target, keyed by correctionKey.
 * Detached corrections apply nowhere, so they are never loaded here.
 */
export async function loadCorrections(
	db: Executor,
	editionId: string,
	target: CorrectionTarget,
): Promise<Map<string, CorrectionRecord>> {
	const rows = await db
		.select(correctionColumns)
		.from(guideCorrections)
		.where(
			and(
				eq(guideCorrections.editionId, editionId),
				eq(guideCorrections.target, target),
				eq(guideCorrections.detached, false),
			),
		);
	return new Map(rows.map((c) => [correctionKey(c.unitLocator, c.nameKey), c]));
}

/** Every correction of the edition, attached or not, oldest first. */
export async function listCorrections(
	db: Executor,
	editionId: string,
): Promise<CorrectionRecord[]> {
	return db
		.select(correctionColumns)
		.from(guideCorrections)
		.where(eq(guideCorrections.editionId, editionId))
		.orderBy(guideCorrections.id);
}
