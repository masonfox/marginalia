import { describe, expect, it } from "vitest";
import {
	decodeConversationCursor,
	encodeConversationCursor,
	isValidConversationCursor,
} from "./conversation-cursor";

const cursor = {
	u: "2026-11-04T10:00:00.654321Z",
	c: "2026-11-03T10:00:00.123456Z",
	i: "00000000-0000-4000-8000-000000000000",
};

const token = (value: unknown) =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

describe("conversation cursor", () => {
	it("round-trips, keeping microseconds", () => {
		const encoded = encodeConversationCursor(cursor);
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeConversationCursor(encoded)).toEqual(cursor);
	});

	it("reads tokens encoded by Node's base64url", () => {
		expect(decodeConversationCursor(token(cursor))).toEqual(cursor);
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
			token({ ...cursor, u: "2026-02-31T00:00:00.000000Z" }),
		],
		[
			"millisecond precision",
			token({ ...cursor, c: "2026-11-03T10:00:00.123Z" }),
		],
		["an id that is not a uuid", token({ ...cursor, i: "42" })],
		["a missing field", token({ u: cursor.u, i: cursor.i })],
		["a shelf cursor", token({ t: "x", c: cursor.c, i: cursor.i })],
	])("rejects %s", (_name, value) => {
		expect(isValidConversationCursor(value)).toBe(false);
	});
});
