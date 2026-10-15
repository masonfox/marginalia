import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { noteRefs, passages, sections } from "#/modules/catalog";
import type { Executor } from "#/server/db";
import { type ResolvedEdition, resolveLocator } from "./resolve";

export interface SectionPassage {
	locator: string;
	kind: string;
	text: string;
	position: number | null;
	/** Compared with a conversation's bound to decide whether the passage is in scope. */
	revealPosition: number;
	notes: { locator: string; text: string }[];
}

export type SectionView =
	| {
			status: "found";
			superseded: boolean;
			requestedLocator: string;
			currentLocator: string;
			edition: ResolvedEdition;
			section: { spineIndex: number; title: string | null; linear: boolean };
			tocPath: string[];
			/** Position of the highlighted passage (or its reveal position for non-linear text). */
			position: number | null;
			passages: SectionPassage[];
			previous: { locator: string; title: string | null } | null;
			next: { locator: string; title: string | null } | null;
	  }
	| { status: "removed"; requestedLocator: string; edition: ResolvedEdition }
	| { status: "not_found"; requestedLocator: string };

/**
 * Everything the passage view needs for one locator: the whole section's
 * text, the notes each passage references, and the neighbouring sections.
 */
export async function getSectionView(
	db: Executor,
	locator: string,
): Promise<SectionView> {
	const resolved = await resolveLocator(db, locator);
	if (resolved.status !== "found") return resolved;
	const editionId = resolved.edition.id;
	const spineIndex = resolved.passage.spineIndex;

	const rows = await db
		.select({
			id: passages.id,
			locator: passages.locator,
			kind: passages.kind,
			text: passages.text,
			position: passages.position,
			revealPosition: passages.revealPosition,
		})
		.from(passages)
		.where(
			and(
				eq(passages.editionId, editionId),
				eq(passages.spineIndex, spineIndex),
			),
		)
		.orderBy(asc(passages.blockIndex));

	const notes = rows.length
		? await db
				.select({
					from: noteRefs.fromPassageId,
					locator: passages.locator,
					text: passages.text,
				})
				.from(noteRefs)
				.innerJoin(passages, eq(noteRefs.toPassageId, passages.id))
				.where(
					inArray(
						noteRefs.fromPassageId,
						rows.map((r) => r.id),
					),
				)
				.orderBy(asc(passages.spineIndex), asc(passages.blockIndex))
		: [];

	const neighbour = async (direction: "previous" | "next") => {
		const [row] = await db
			.select({ locator: passages.locator, title: sections.title })
			.from(passages)
			.innerJoin(sections, eq(passages.sectionId, sections.id))
			.where(
				and(
					eq(passages.editionId, editionId),
					direction === "previous"
						? lt(passages.spineIndex, spineIndex)
						: gt(passages.spineIndex, spineIndex),
				),
			)
			.orderBy(
				direction === "previous"
					? desc(passages.spineIndex)
					: asc(passages.spineIndex),
				asc(passages.blockIndex),
			)
			.limit(1);
		return row ?? null;
	};

	return {
		status: "found",
		superseded: resolved.superseded,
		requestedLocator: resolved.requestedLocator,
		currentLocator: resolved.currentLocator,
		edition: resolved.edition,
		section: resolved.section,
		tocPath: resolved.tocPath,
		position: resolved.passage.position ?? resolved.passage.revealPosition,
		passages: rows.map((r) => ({
			locator: r.locator,
			kind: r.kind,
			text: r.text,
			position: r.position,
			revealPosition: r.revealPosition,
			notes: notes
				.filter((n) => n.from === r.id)
				.map(({ locator, text }) => ({ locator, text })),
		})),
		previous: await neighbour("previous"),
		next: await neighbour("next"),
	};
}
