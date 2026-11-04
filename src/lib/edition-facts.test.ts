import { describe, expect, it } from "vitest";
import {
	formatCount,
	formatPublished,
	identifierRows,
	languageName,
} from "./edition-facts";

describe("languageName", () => {
	it("names two- and three-letter codes and regional variants", () => {
		expect(languageName("eng")).toBe("English");
		expect(languageName("en")).toBe("English");
		expect(languageName("fre")).toBe("French");
		expect(languageName("en-GB")).toBe("British English");
		expect(languageName("en_US")).toBe("American English");
	});

	it("keeps unknown or malformed codes as written, and drops empty ones", () => {
		expect(languageName("zzz")).toBe("zzz");
		expect(languageName("not a code")).toBe("not a code");
		expect(languageName("  ")).toBeNull();
		expect(languageName(null)).toBeNull();
	});
});

describe("formatPublished", () => {
	it("shows January 1st placeholders as just the year", () => {
		expect(formatPublished("1985-01-01")).toEqual({
			label: "1985",
			dateTime: "1985",
		});
		expect(formatPublished("1997-01-01T00:00:00+00:00")?.label).toBe("1997");
		expect(formatPublished("1985")?.label).toBe("1985");
	});

	it("shows real dates to the precision recorded", () => {
		expect(formatPublished("2007-03-20")).toEqual({
			label: "March 20, 2007",
			dateTime: "2007-03-20",
		});
		expect(formatPublished("2007-03")).toEqual({
			label: "March 2007",
			dateTime: "2007-03",
		});
		expect(formatPublished("2017-10-19T01:55:17Z")?.label).toBe(
			"October 19, 2017",
		);
		// A timestamp on New Year's Day past midnight is a real date.
		expect(formatPublished("2020-01-01T09:30:00Z")?.label).toBe(
			"January 1, 2020",
		);
	});

	it("keeps text that is not a date as written", () => {
		expect(formatPublished("Spring 1922")).toEqual({
			label: "Spring 1922",
			dateTime: null,
		});
		expect(formatPublished("2007-13-01")?.dateTime).toBeNull();
		expect(formatPublished("")).toBeNull();
		expect(formatPublished(null)).toBeNull();
	});
});

describe("formatCount", () => {
	it("groups thousands", () => {
		expect(formatCount(12345)).toBe("12,345");
		expect(formatCount(7)).toBe("7");
	});
});

describe("identifierRows", () => {
	it("labels, links, and orders declared schemes, tucking away bookkeeping ids", () => {
		const rows = identifierRows([
			{ scheme: null, value: "uuid:c7112b7c-7b5f-40c8-9cea-174818c934f6" },
			{ scheme: "ISBN", value: "9780316066525" },
			{ scheme: "GOODREADS", value: "75786" },
			{ scheme: "HARDCOVER", value: "infinite-jest" },
			{ scheme: "HARDCOVER_EDITION", value: "17977780" },
		]);
		expect(rows.map((r) => [r.label, r.value, r.href, r.internal])).toEqual([
			[
				"ISBN",
				"9780316066525",
				"https://openlibrary.org/isbn/9780316066525",
				false,
			],
			[
				"Goodreads",
				"75786",
				"https://www.goodreads.com/book/show/75786",
				false,
			],
			[
				"Hardcover",
				"infinite-jest",
				"https://hardcover.app/books/infinite-jest",
				false,
			],
			["Hardcover edition", "17977780", null, true],
			["UUID", "c7112b7c-7b5f-40c8-9cea-174818c934f6", null, true],
		]);
	});

	it("reads schemes written into the value and drops duplicates", () => {
		const rows = identifierRows([
			{ scheme: null, value: "isbn:9780307781925" },
			{ scheme: null, value: "hardcover-id:438682" },
			{ scheme: null, value: "hardcover-slug:the-rise-of-endymion" },
			{ scheme: null, value: "calibre:822" },
			{ scheme: null, value: "ISBN:978-0-307-78192-5" },
			{ scheme: "ISBN", value: "9780307781925" },
		]);
		expect(rows.map((r) => `${r.label} ${r.value}`)).toEqual([
			"ISBN 9780307781925",
			"Hardcover the-rise-of-endymion",
			"Hardcover ID 438682",
			"Calibre 822",
		]);
		expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
	});

	it("links bare web addresses and leaves unknown schemes unlinked", () => {
		const rows = identifierRows([
			{ scheme: null, value: "https://standardebooks.org/ebooks/x/y" },
			{ scheme: "MOBI-ASIN", value: "B000FC1PJI" },
			{ scheme: "LCCN", value: "2006286637" },
			{ scheme: null, value: "local-123" },
		]);
		expect(rows.map((r) => [r.label, r.href])).toEqual([
			["ASIN", null],
			["Web", "https://standardebooks.org/ebooks/x/y"],
			["LCCN", null],
			["Identifier", null],
		]);
	});

	it("does not link ids that do not fit their scheme", () => {
		const [isbn, goodreads] = identifierRows([
			{ scheme: "ISBN", value: "not-an-isbn" },
			{ scheme: "GOODREADS", value: "../evil" },
		]);
		expect(isbn?.href).toBeNull();
		expect(goodreads?.href).toBeNull();
	});
});
