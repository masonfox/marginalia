import {
	PASSAGE_REF_LIMIT,
	type PassageRef,
	type PassageSnapshot,
} from "#/lib/passage-ref";
import { getReadingUnits } from "#/modules/catalog";
import { createRetrieval } from "#/modules/retrieval";
import type { Executor } from "#/server/db";
import type { ConversationBook } from "./repository";

export type PassageRefInvalid =
	| "not_found"
	| "removed"
	| "not_in_conversation"
	| "bad_range"
	| "too_long";

export type PassageCheck =
	| { status: "ok"; snapshot: PassageSnapshot }
	| {
			status: "out_of_scope";
			editionId: string;
			/** The reading unit containing the passage; null when no unit does. */
			unitLabel: string | null;
	  }
	| { status: "invalid"; reason: PassageRefInvalid };

/**
 * Resolves a passage reference against a conversation and snapshots its text
 * from the stored book. Superseded locators forward to the current passage,
 * and the passage must be in one of the conversation's books, within its
 * bound for that book.
 */
export async function checkPassageRef(
	db: Executor,
	conversation: { books: ConversationBook[] },
	ref: PassageRef,
): Promise<PassageCheck> {
	const invalid = (reason: PassageRefInvalid) =>
		({ status: "invalid", reason }) as const;
	const resolved = await createRetrieval(db).resolve(ref.locator);
	if (resolved.status !== "found") return invalid(resolved.status);
	const book = conversation.books.find(
		(b) => b.editionId === resolved.edition.id,
	);
	if (!book) return invalid("not_in_conversation");
	const { passage } = resolved;
	const range = ref.range;
	if (range && (range.start >= range.end || range.end > passage.text.length))
		return invalid("bad_range");
	const text = (
		range ? passage.text.slice(range.start, range.end) : passage.text
	).trim();
	if (!text) return invalid("bad_range");
	if (text.length > PASSAGE_REF_LIMIT) return invalid("too_long");
	if (book.maxPosition !== null && passage.revealPosition > book.maxPosition) {
		const units = await getReadingUnits(db, book.editionId);
		const unit = units.find((u) => u.endPosition >= passage.revealPosition);
		return {
			status: "out_of_scope",
			editionId: book.editionId,
			unitLabel: unit?.label ?? null,
		};
	}
	return {
		status: "ok",
		snapshot: {
			locator: resolved.currentLocator,
			...(range ? { range: { start: range.start, end: range.end } } : {}),
			editionId: book.editionId,
			bookTitle: book.title,
			sectionTitle: resolved.tocPath.at(-1) ?? resolved.section.title,
			text,
		},
	};
}
