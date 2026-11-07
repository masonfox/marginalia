import { describe, expect, it } from "vitest";
import { normalizeIsbn } from "./isbn";

describe("normalizeIsbn", () => {
	it("keeps a valid ISBN-13 and strips hyphens, spaces and prefixes", () => {
		for (const raw of [
			"9780306406157",
			"978-0-306-40615-7",
			"978 0 306 40615 7",
			" urn:isbn:978-0-306-40615-7 ",
			"ISBN:9780306406157",
			"isbn 978-0306406157",
			"ISBN-13: 978-0-306-40615-7",
		]) {
			expect(normalizeIsbn(raw), raw).toBe("9780306406157");
		}
	});

	it("converts an ISBN-10 to ISBN-13", () => {
		expect(normalizeIsbn("0-306-40615-2")).toBe("9780306406157");
		expect(normalizeIsbn("urn:isbn:0306406152")).toBe("9780306406157");
		expect(normalizeIsbn("0-8044-2957-X")).toBe("9780804429573");
		expect(normalizeIsbn("080442957x")).toBe("9780804429573");
		expect(normalizeIsbn("0000000000")).toBe("9780000000002");
		expect(normalizeIsbn("978-0-00-000000-2")).toBe("9780000000002");
	});

	it("rejects bad check digits", () => {
		expect(normalizeIsbn("9780306406158")).toBeNull();
		expect(normalizeIsbn("0-306-40615-3")).toBeNull();
		// The ISBN-13 check digit tacked onto an ISBN-10 is not valid.
		expect(normalizeIsbn("0000000002")).toBeNull();
	});

	it("rejects things that are not ISBNs", () => {
		for (const raw of [
			"",
			"12345",
			"1234567890123",
			"978030640615",
			"97803064061577",
			"X306406152",
			"urn:uuid:9780306406157",
			"abc-def",
		]) {
			expect(normalizeIsbn(raw), raw).toBeNull();
		}
	});
});
