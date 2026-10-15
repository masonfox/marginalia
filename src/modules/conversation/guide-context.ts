// Guide context (design D9, D10): the merged, bounded book maps a reply is
// sent, what the reply records about them, and how the research trail reads
// the guide again later, without spoiling past the conversation's scope.
import { createHash } from "node:crypto";
import { type DerivedCitation, normalizeNameKey } from "#/modules/analysis";
import {
	type CorrectionMark,
	type GuideSummary,
	getMergedSummaries,
	getUnitAnchors,
	observationText,
	resolveObservations,
	type UnitAnchors,
} from "#/modules/guide";
import type { Executor } from "#/server/db";
import { type PromptSummary, renderBookBlock } from "./prompt";
import { type ConversationBook, getConversationBooks } from "./repository";
import type { GuideContextEntry } from "./schema";
import { bookHandle } from "./tools";

/** A merged summary as the map renders it: the reader's replacement is labelled. */
const toPromptSummary = (s: GuideSummary): PromptSummary => ({
	unitOrdinal: s.unitOrdinal,
	unitLabel: s.unitLabel,
	summary: s.summary,
	...(s.correction && { source: "reader correction" as const }),
});

/** sha256 of a book's rendered map block: what a reply records instead of the text. */
export const mapFingerprint = (block: string) =>
	createHash("sha256").update(block).digest("hex");

/**
 * A book's map at a bound: its merged summaries (reader corrections applied,
 * suppressed ones omitted) and its rendered block, null when it has none.
 */
async function bookMap(
	db: Executor,
	book: Pick<ConversationBook, "editionId" | "ordinal">,
	bound: number | null,
	anchors?: UnitAnchors,
): Promise<{ summaries: GuideSummary[]; block: string | null }> {
	const summaries = await getMergedSummaries(
		db,
		book.editionId,
		bound,
		anchors ?? (await getUnitAnchors(db, book.editionId)),
	);
	return {
		summaries,
		block: renderBookBlock(book, summaries.map(toPromptSummary)),
	};
}

/**
 * The maps of a conversation's books, keyed by handle, and the guide context
 * a reply records for them: one entry per book that has a map, null when
 * none does. A map depends only on the book's scope, its current summaries
 * and the corrections to summaries within that scope.
 */
export async function loadBookMaps(
	db: Executor,
	books: ConversationBook[],
): Promise<{
	maps: Record<string, PromptSummary[]>;
	guideContext: GuideContextEntry[] | null;
}> {
	const loaded = await Promise.all(
		books.map(async (book) => ({
			book,
			...(await bookMap(db, book, book.maxPosition)),
		})),
	);
	const maps: Record<string, PromptSummary[]> = {};
	const guideContext: GuideContextEntry[] = [];
	for (const { book, summaries, block } of loaded) {
		maps[bookHandle(book)] = summaries.map(toPromptSummary);
		if (block === null) continue;
		guideContext.push({
			editionId: book.editionId,
			scopeLabel: book.scopeLabel,
			maxPosition: book.maxPosition,
			mapFingerprint: mapFingerprint(block),
		});
	}
	return { maps, guideContext: guideContext.length > 0 ? guideContext : null };
}

/** The lower of two bounds, null being the whole book. */
const lowerBound = (a: number | null, b: number | null) =>
	a === null ? b : b === null ? a : Math.min(a, b);

/** The reader's correction of a trail item, as the correction dialog edits it. */
export interface TrailCorrection {
	id: number;
	action: "replace" | "suppress";
	text: string | null;
	citation: DerivedCitation | null;
}

const trailCorrection = (
	mark: CorrectionMark | null,
	replaced: { text: string; citations: DerivedCitation[] },
): TrailCorrection | null =>
	mark && {
		id: mark.id,
		action: mark.action,
		text: mark.action === "replace" ? replaced.text : null,
		citation:
			mark.action === "replace" ? (replaced.citations[0] ?? null) : null,
	};

/** A summary listed under a reply's guide step. */
export interface GuideStepSummary {
	unitLabel: string;
	/** The unit's anchor, which a correction names. */
	unitLocator: string;
	/** The merged text: the reader's when they replaced it. */
	summary: string;
	/** The current generated text a correction covers. */
	generated: string;
	correction: TrailCorrection | null;
}

/**
 * A reply's guide step read again: `gone` when the book is no longer in the
 * conversation (it was deleted). Otherwise the summaries now within the
 * recorded scope, and whether the map those make differs from the one the
 * reply recorded.
 */
export type GuideStepView =
	| { status: "gone" }
	| {
			status: "ok";
			summaries: GuideStepSummary[];
			/** The guide changed since the reply: the map it would send now differs. */
			changed: boolean;
	  };

/**
 * Lists the summaries now within a reply's recorded scope for one book, with
 * corrections applied, and compares the map they make with the recorded
 * fingerprint. Never reads past the conversation's current scope.
 */
export async function getGuideStep(
	db: Executor,
	input: {
		conversationId: string;
		editionId: string;
		maxPosition: number | null;
		mapFingerprint: string;
	},
): Promise<GuideStepView> {
	const books = await getConversationBooks(db, input.conversationId);
	const book = books.find((b) => b.editionId === input.editionId);
	if (!book) return { status: "gone" };
	const bound = lowerBound(input.maxPosition, book.maxPosition);
	const { summaries, block } = await bookMap(db, book, bound);
	return {
		status: "ok",
		summaries: summaries.map((s) => ({
			unitLabel: s.unitLabel,
			unitLocator: s.unitLocator,
			summary: s.summary,
			generated: s.correction?.generated ?? s.summary,
			correction: trailCorrection(s.correction, {
				text: s.summary,
				citations: s.citations,
			}),
		})),
		changed: block === null || mapFingerprint(block) !== input.mapFingerprint,
	};
}

/** An observation of a lookup step as it is now, for "Correct this". */
export interface TrailObservation {
	unitLabel: string;
	unitLocator: string;
	nameKey: string;
	/** The name shown for it. */
	name: string;
	generated: string;
	correction: TrailCorrection | null;
}

/**
 * The current rows behind the items of a stored observation lookup, matched
 * by unit label and observed name, within the conversation's current scope.
 * An item whose row is no longer current (or whose book is gone) is null, so
 * it offers no correction.
 */
export async function getTrailObservations(
	db: Executor,
	input: {
		conversationId: string;
		editionId: string;
		/** The name the model looked up. */
		name: string;
		items: { unitLabel: string; observedAs: string }[];
	},
): Promise<(TrailObservation | null)[]> {
	const books = await getConversationBooks(db, input.conversationId);
	const book = books.find((b) => b.editionId === input.editionId);
	if (!book) return input.items.map(() => null);
	const anchors = await getUnitAnchors(db, book.editionId);
	const found = await resolveObservations(
		db,
		book.editionId,
		input.name,
		book.maxPosition,
		anchors,
		{ includeHidden: true },
	);
	const rows = found?.observations ?? [];
	return input.items.map((item) => {
		const key = normalizeNameKey(item.observedAs);
		const group = rows.filter(
			(r) => r.unitLabel === item.unitLabel && r.nameKey === key,
		);
		const [row] = group;
		if (!row) return null;
		return {
			unitLabel: row.unitLabel,
			unitLocator: row.unitLocator,
			nameKey: row.nameKey,
			name: row.name,
			generated:
				row.correction?.generated ?? observationText(group.map((r) => r.note)),
			correction: trailCorrection(row.correction, {
				text: row.note,
				citations: row.citations,
			}),
		};
	});
}
