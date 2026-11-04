import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const builder = {
			validator: (_schema: unknown) => builder,
			handler: (handler: unknown) => handler,
		};
		return builder;
	},
}));

import { listShelfInput } from "./library";

describe("listShelfFn input", () => {
	it("accepts a search, a filter, and a cursor the server issued", () => {
		const cursor = Buffer.from(
			JSON.stringify({
				t: "to the lighthouse",
				c: "2026-11-03T10:00:00.123456Z",
				i: "00000000-0000-4000-8000-000000000000",
			}),
		).toString("base64url");
		expect(
			listShelfInput.safeParse({ q: "woolf", status: "finished", cursor })
				.success,
		).toBe(true);
		expect(listShelfInput.safeParse({}).success).toBe(true);
	});

	it.each([
		["an overlong query", { q: "x".repeat(201) }],
		["an unknown filter", { status: "ready" }],
		["a malformed cursor", { cursor: "not-a-cursor" }],
		[
			"a cursor with the wrong shape",
			{ cursor: Buffer.from('{"t":1}').toString("base64url") },
		],
	])("rejects %s", (_name, input) => {
		expect(listShelfInput.safeParse(input).success).toBe(false);
	});
});
