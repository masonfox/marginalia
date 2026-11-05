// How a row in a list of conversations across books names its books.

/** The most books a conversation started from the UI may hold. */
export const MAX_CONVERSATION_BOOKS = 3;

/** "Through Chapter 22" or "Whole book". */
export const scopeText = (label: string | null) =>
	label === null ? "Whole book" : `Through ${label}`;

export interface LabelledBook {
	title: string;
	/** The reading unit the conversation is scoped through; null means whole book. */
	scopeLabel: string | null;
}

export interface BooksLabel {
	/** Shown on the row: one title and its scope, two titles, or the first title and "+N". */
	text: string;
	/** For assistive technology: every title with its scope. */
	description: string;
}

/** The label of a conversation's books, given in their stored order. */
export function conversationBooksLabel(books: LabelledBook[]): BooksLabel {
	const [first, second] = books;
	const description = books
		.map(
			(b) =>
				`${b.title}, ${b.scopeLabel === null ? "whole book" : `through ${b.scopeLabel}`}`,
		)
		.join("; ");
	if (!first) return { text: "No books", description: "No books" };
	if (books.length === 1)
		return {
			text: `${first.title} · ${scopeText(first.scopeLabel)}`,
			description,
		};
	if (books.length === 2 && second)
		return { text: `${first.title} and ${second.title}`, description };
	return { text: `${first.title} +${books.length - 1}`, description };
}
