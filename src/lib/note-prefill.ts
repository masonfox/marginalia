// "Save as note" from a conversation: the draft a new note starts from,
// handed to the note editor as router state so nothing is stored until the
// reader saves it.

/** Where the note is written "as of": the shape the note editor takes. */
export type ExcerptAnchor =
	| { kind: "unit"; endPosition: number }
	| { kind: "end" };

/** A new note's draft from a reply excerpt. */
export interface ExcerptNoteDraft {
	/** The book the note is for; the editor ignores a draft for another book. */
	editionId: string;
	title: string;
	body: string;
	anchor: ExcerptAnchor;
	/** The anchor's label: the scope's unit, or null for the end of the book. */
	anchorLabel: string | null;
	sourceConversationId: string;
}

declare module "@tanstack/react-router" {
	interface HistoryState {
		/** A note draft handed to the note editor by "Save as note". */
		noteDraft?: ExcerptNoteDraft;
	}
}

/** The longest title the draft suggests; the reader can change it. */
const TITLE_CHARS = 80;

/** Quotes text as a Markdown blockquote, keeping blank lines inside it. */
export const quoteMarkdown = (text: string) =>
	text
		.split("\n")
		.map((line) => (line.trim() ? `> ${line}` : ">"))
		.join("\n");

/**
 * The draft of a note saved from a reply excerpt: the excerpt quoted, a link
 * back to the conversation, and an "as of" anchor at the conversation's
 * scope for the book (its unit, or the end of the book for the whole book).
 */
export function excerptNoteDraft(input: {
	excerpt: string;
	conversation: { id: string; title: string };
	book: {
		editionId: string;
		maxPosition: number | null;
		scopeLabel: string | null;
	};
}): ExcerptNoteDraft {
	const { excerpt, conversation, book } = input;
	const title = `From “${conversation.title}”`;
	// Link text is escaped so a title cannot break out of the link.
	const linkText = conversation.title.replace(/[[\]\\]/g, "\\$&");
	return {
		editionId: book.editionId,
		title:
			title.length <= TITLE_CHARS
				? title
				: `${title.slice(0, TITLE_CHARS - 2)}…”`,
		body: `${quoteMarkdown(excerpt.trim())}\n\nFrom the conversation [${linkText}](/c/${conversation.id}).\n\n`,
		anchor:
			book.maxPosition === null
				? { kind: "end" }
				: { kind: "unit", endPosition: book.maxPosition },
		anchorLabel: book.scopeLabel,
		sourceConversationId: conversation.id,
	};
}
