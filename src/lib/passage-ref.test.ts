import { describe, expect, it } from "vitest";
import {
	attachmentKey,
	type PassageSnapshot,
	parsePassageLink,
	passageContextOf,
	passageContextPart,
	passageHref,
	projectPassageContext,
} from "./passage-ref";
import { replyContextPart } from "./reply-context";

const origin = "https://books.example:8443";
const locator = "3f9a1c07b2de:v1:12.47";

describe("parsePassageLink", () => {
	it("accepts same-origin absolute URLs and root-relative paths", () => {
		for (const text of [
			`${origin}/p/${locator}`,
			`  ${origin}/p/${locator}\n`,
			`${origin}/p/${encodeURIComponent(locator)}`,
			`/p/${locator}`,
			`/p/${locator}/`,
			`/p/${locator}#top`,
		])
			expect(parsePassageLink(text, origin)).toEqual({ locator });
	});
	it("reads hl ranges", () => {
		expect(parsePassageLink(`${origin}/p/${locator}?hl=10-42`, origin)).toEqual(
			{ locator, range: { start: 10, end: 42 } },
		);
		expect(parsePassageLink(`/p/${locator}?hl=0-1`, origin)).toEqual({
			locator,
			range: { start: 0, end: 1 },
		});
	});
	it("rejects other origins", () => {
		for (const text of [
			`https://elsewhere.example/p/${locator}`,
			`http://books.example:8443/p/${locator}`,
			`https://books.example/p/${locator}`,
			`//elsewhere.example/p/${locator}`,
		])
			expect(parsePassageLink(text, origin)).toBeNull();
	});
	it("rejects links inside longer text", () => {
		for (const text of [
			`See ${origin}/p/${locator}`,
			`${origin}/p/${locator} is great`,
			`/p/${locator} /p/${locator}`,
		])
			expect(parsePassageLink(text, origin)).toBeNull();
	});
	it("rejects malformed locators, paths, and ranges", () => {
		for (const text of [
			"/p/not-a-locator",
			"/p/3f9a1c07b2de:v1:12",
			`/p/${locator}/more`,
			`/c/${locator}`,
			`/p/${locator}?hl=42-10`,
			`/p/${locator}?hl=5-5`,
			`/p/${locator}?hl=-1-4`,
			`/p/${locator}?hl=abc`,
			`/p/${locator}?hl=`,
			"/p/%E0%A4%A",
			"",
			"not a url",
		])
			expect(parsePassageLink(text, origin)).toBeNull();
	});
	it("round-trips through passageHref", () => {
		for (const ref of [{ locator }, { locator, range: { start: 3, end: 9 } }])
			expect(parsePassageLink(passageHref(ref), origin)).toEqual(ref);
		expect(passageHref({ locator, range: { start: 3, end: 9 } })).toBe(
			`/p/${locator}?hl=3-9`,
		);
	});
});

const snapshot: PassageSnapshot = {
	locator,
	range: { start: 4, end: 9 },
	editionId: "ed1",
	bookTitle: "The Communist Manifesto",
	sectionTitle: "Bourgeois and Proletarians",
	text: "history of class struggles",
};

describe("passage context", () => {
	it("projects a labelled passage with its locator, once, without mutation", () => {
		const parts = [
			passageContextPart(snapshot),
			{ type: "text", text: "Why?" },
		];
		const before = JSON.stringify(parts);
		const projected = projectPassageContext(parts) as {
			type: string;
			text: string;
		}[];
		expect(projected).toHaveLength(2);
		expect(projected[0]?.text).toBe(
			`The reader is referring to this passage from The Communist Manifesto (Bourgeois and Proletarians), locator ${locator}. It is quoted from the book.\n<referenced-passage locator="${locator}">\nhistory of class struggles\n</referenced-passage>\nNew reader message:\n`,
		);
		expect(projected[1]).toEqual({ type: "text", text: "Why?" });
		expect(JSON.stringify(parts)).toBe(before);
		expect(projectPassageContext(parts)).toEqual(projected);
	});
	it("leaves parts without context untouched", () => {
		const parts = [{ type: "text", text: "legacy" }];
		expect(projectPassageContext(parts)).toBe(parts);
		expect(passageContextOf(parts)).toBeUndefined();
	});
	it("ignores invalid stored data", () => {
		for (const data of [
			{ ...snapshot, version: 2 },
			{ ...snapshot, version: 1, locator: "nope" },
			{ ...snapshot, version: 1, text: "" },
			{ ...snapshot, version: 1, text: "x".repeat(4001) },
			{ ...snapshot, version: 1, range: { start: 9, end: 4 } },
			null,
		]) {
			const parts = [
				{ type: "data-passage-context", data },
				{ type: "text", text: "Q" },
			];
			expect(passageContextOf(parts)).toBeUndefined();
			expect(projectPassageContext(parts)).toBe(parts);
		}
	});
	it("omits a missing section title", () => {
		const parts = [passageContextPart({ ...snapshot, sectionTitle: null })];
		const [first] = projectPassageContext(parts) as { text: string }[];
		expect(first?.text).toMatch(
			/^The reader is referring to this passage from The Communist Manifesto, locator /,
		);
	});
	it("keys attachments by kind, locator, and range", () => {
		const text = { type: "text", text: "Q" };
		const quote = replyContextPart({
			messageId: "11111111-1111-4111-8111-111111111111",
			text: "quoted",
		});
		const keys = [
			attachmentKey([text]),
			attachmentKey([quote, text]),
			attachmentKey([passageContextPart(snapshot), text]),
			attachmentKey([
				passageContextPart({ ...snapshot, range: undefined }),
				text,
			]),
		];
		expect(new Set(keys).size).toBe(4);
		// The server's snapshot text may differ from the client's; the key does not.
		expect(
			attachmentKey([passageContextPart({ ...snapshot, text: "other" })]),
		).toBe(attachmentKey([passageContextPart(snapshot)]));
	});
});
