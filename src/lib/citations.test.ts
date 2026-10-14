import { describe, expect, it } from "vitest";
import {
	parseCitationMarkers,
	parseHighlight,
	segmentCitations,
} from "./citations";

describe("parseCitationMarkers", () => {
	it("parses a valid marker with its position", () => {
		const text =
			'See [[cite locator="ab:v1:2.3" quote="the green light"]] here.';
		const [m, ...rest] = parseCitationMarkers(text);
		expect(rest).toEqual([]);
		expect(m).toMatchObject({
			locator: "ab:v1:2.3",
			quote: "the green light",
			start: 4,
		});
		expect(text.slice(m?.start, m?.end)).toBe(m?.raw);
		expect(m?.raw.endsWith("]]")).toBe(true);
	});

	it("accepts either attribute order and extra spacing", () => {
		const [m] = parseCitationMarkers(
			'[[cite   quote="words"   locator = "ab:v1:0.0" ]]',
		);
		expect(m).toMatchObject({ locator: "ab:v1:0.0", quote: "words" });
	});

	it("unescapes quotes and backslashes inside values", () => {
		const [m] = parseCitationMarkers(
			String.raw`[[cite locator="ab:v1:0.1" quote="He said \"old sport\" and a \\ slash"]]`,
		);
		expect(m?.quote).toBe('He said "old sport" and a \\ slash');
	});

	it("keeps curly quotes and brackets inside the quote", () => {
		const [m] = parseCitationMarkers(
			'[[cite locator="ab:v1:0.1" quote="“Old sport,” [sic] ]] odd"]]',
		);
		expect(m?.quote).toBe("“Old sport,” [sic] ]] odd");
	});

	it("finds multiple markers", () => {
		const found = parseCitationMarkers(
			'A [[cite locator="a:v1:0.0" quote="one"]] B [[cite locator="a:v1:0.1" quote="two"]].',
		);
		expect(found.map((m) => m.quote)).toEqual(["one", "two"]);
	});

	it("ignores malformed markers and recovers for later valid ones", () => {
		const text = [
			'[[cite locator="a:v1:0.0"]]',
			'[[cite quote="no locator"]]',
			'[[cite locator="a:v1:0.0" quote="unterminated]]',
			"[[cite locator=a:v1:0.0 quote=x]]",
			'[[cite locator="a:v1:0.0" quote=""]]',
			'[[cite locator="a:v1:0.0" quote="fine"]]',
			"[[cite",
		].join(" ");
		const found = parseCitationMarkers(text);
		expect(found.map((m) => m.quote)).toEqual(["fine"]);
	});

	it("returns nothing for text without markers", () => {
		expect(parseCitationMarkers("No citations [[here]]")).toEqual([]);
		expect(parseCitationMarkers("")).toEqual([]);
	});
});

describe("segmentCitations", () => {
	it("interleaves text and markers and keeps malformed markers as text", () => {
		const text =
			'Before [[cite locator="a:v1:0.0" quote="one"]] middle [[cite broken]] after.';
		const segments = segmentCitations(text);
		expect(segments.map((s) => s.kind)).toEqual(["text", "cite", "text"]);
		expect(segments[2]).toEqual({
			kind: "text",
			text: " middle [[cite broken]] after.",
		});
		expect(segmentCitations("")).toEqual([]);
	});
});

describe("parseHighlight", () => {
	it("parses valid ranges and rejects everything else", () => {
		expect(parseHighlight("4-15")).toEqual({ start: 4, end: 15 });
		for (const bad of [
			undefined,
			"",
			"15-4",
			"4-4",
			"a-b",
			"4-",
			"-4",
			"4-15x",
		]) {
			expect(parseHighlight(bad)).toBeNull();
		}
	});
});
