/** How much of the reader's own guide content a book has (see countReaderContent). */
export interface ReaderContentCounts {
	notes: number;
	corrections: number;
	/** Subjects the reader confirmed (merged, renamed, or gave a kind). */
	subjects: number;
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/**
 * What the book deletion confirmation says about the reader's notes and
 * guide edits (corrections and confirmed subjects), or null when the book
 * has none.
 */
export function readerContentWarning(
	counts: ReaderContentCounts,
): string | null {
	const edits = [
		counts.corrections > 0
			? plural(counts.corrections, "correction", "corrections")
			: null,
		counts.subjects > 0
			? plural(counts.subjects, "confirmed subject", "confirmed subjects")
			: null,
	].filter((part) => part !== null);
	const notes =
		counts.notes > 0 ? `your ${plural(counts.notes, "note", "notes")}` : null;
	const detail = edits.length > 0 ? ` (${edits.join(", ")})` : "";
	if (notes && edits.length > 0)
		return `It also deletes ${notes} and guide edits${detail} for this book.`;
	if (notes) return `It also deletes ${notes} for this book.`;
	if (edits.length > 0)
		return `It also deletes your guide edits${detail} for this book.`;
	return null;
}
