import { describe, expect, it } from "vitest";
import { conversationBooksLabel, scopeText } from "./conversation-books";

const jest = { title: "Infinite Jest", scopeLabel: "Year of Glad" };
const paleKing = { title: "The Pale King", scopeLabel: null };
const lighthouse = { title: "To the Lighthouse", scopeLabel: "Time Passes" };

describe("scopeText", () => {
	it("names a bounded scope and the whole book", () => {
		expect(scopeText("Year of Glad")).toBe("Through Year of Glad");
		expect(scopeText(null)).toBe("Whole book");
	});
});

describe("conversationBooksLabel", () => {
	it("shows one book's title with its scope", () => {
		expect(conversationBooksLabel([jest])).toEqual({
			text: "Infinite Jest · Through Year of Glad",
			description: "Infinite Jest, through Year of Glad",
		});
		expect(conversationBooksLabel([paleKing]).text).toBe(
			"The Pale King · Whole book",
		);
	});

	it("shows both titles of two books, in order", () => {
		expect(conversationBooksLabel([jest, paleKing])).toEqual({
			text: "Infinite Jest and The Pale King",
			description:
				"Infinite Jest, through Year of Glad; The Pale King, whole book",
		});
	});

	it("shows the first title and +N for three or more, describing every book", () => {
		const label = conversationBooksLabel([jest, paleKing, lighthouse]);
		expect(label.text).toBe("Infinite Jest +2");
		expect(label.description).toBe(
			"Infinite Jest, through Year of Glad; The Pale King, whole book; To the Lighthouse, through Time Passes",
		);
		expect(
			conversationBooksLabel([jest, paleKing, lighthouse, jest]).text,
		).toBe("Infinite Jest +3");
	});

	it("keeps titles as given, markup included", () => {
		expect(
			conversationBooksLabel([{ title: "<b>Bold</b>", scopeLabel: null }]).text,
		).toBe("<b>Bold</b> · Whole book");
	});

	it("says so when a conversation has no books", () => {
		expect(conversationBooksLabel([]).text).toBe("No books");
	});
});
