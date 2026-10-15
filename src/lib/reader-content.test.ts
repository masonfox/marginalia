import { describe, expect, it } from "vitest";
import { readerContentWarning } from "./reader-content";

const counts = (notes: number, corrections: number, subjects: number) => ({
	notes,
	corrections,
	subjects,
});

describe("readerContentWarning", () => {
	it("says nothing for a book without notes or guide edits", () => {
		expect(readerContentWarning(counts(0, 0, 0))).toBeNull();
	});

	it("mentions notes and guide edits together", () => {
		expect(readerContentWarning(counts(3, 2, 1))).toBe(
			"It also deletes your 3 notes and guide edits (2 corrections, 1 confirmed subject) for this book.",
		);
	});

	it("mentions notes alone", () => {
		expect(readerContentWarning(counts(1, 0, 0))).toBe(
			"It also deletes your 1 note for this book.",
		);
	});

	it("mentions corrections or confirmed subjects alone as guide edits", () => {
		expect(readerContentWarning(counts(0, 1, 0))).toBe(
			"It also deletes your guide edits (1 correction) for this book.",
		);
		expect(readerContentWarning(counts(0, 0, 2))).toBe(
			"It also deletes your guide edits (2 confirmed subjects) for this book.",
		);
	});
});
