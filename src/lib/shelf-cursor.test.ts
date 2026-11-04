import { describe, expect, it } from "vitest";
import {
	decodeShelfCursor,
	encodeShelfCursor,
	isValidShelfCursor,
} from "./shelf-cursor";

const cursor = {
	t: "ἰλιάς — the iliad",
	c: "2026-11-03T10:00:00.123456Z",
	i: "00000000-0000-4000-8000-000000000000",
};

describe("shelf cursor", () => {
	it("round-trips, including non-ASCII titles", () => {
		const token = encodeShelfCursor(cursor);
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeShelfCursor(token)).toEqual(cursor);
	});

	it("reads tokens encoded by Node's base64url", () => {
		const token = Buffer.from(JSON.stringify(cursor)).toString("base64url");
		expect(decodeShelfCursor(token)).toEqual(cursor);
	});

	it.each([
		["characters outside base64url", "abc+/="],
		["an impossible length", "a"],
		["bytes that are not JSON", Buffer.from("nope").toString("base64url")],
		[
			"invalid UTF-8",
			Buffer.from([0x7b, 0xff, 0xfe, 0x7d]).toString("base64url"),
		],
		[
			"a rolled-over date",
			Buffer.from(
				JSON.stringify({ ...cursor, c: "2026-02-31T00:00:00.000000Z" }),
			).toString("base64url"),
		],
		[
			"a missing field",
			Buffer.from(JSON.stringify({ t: "x", c: cursor.c })).toString(
				"base64url",
			),
		],
	])("rejects %s", (_name, token) => {
		expect(isValidShelfCursor(token)).toBe(false);
	});
});
