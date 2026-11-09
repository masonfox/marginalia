import { describe, expect, it } from "vitest";
import { adoptableThread, isNewThreadCandidate } from "./new-thread";

const anchor = { anchorMessageId: "a1", quote: "the quoted passage" };
const thread = (
	id: string,
	over: Partial<{
		anchorMessageId: string;
		anchorQuote: string;
		firstUserText: string | null;
	}> = {},
) => ({
	id,
	anchorMessageId: "a1",
	anchorQuote: "the quoted passage",
	firstUserText: "What does this mean?",
	...over,
});
const none = new Set<string>();

describe("adoptableThread", () => {
	it("adopts the one new thread with the same anchor, quote, and first message", () => {
		expect(
			adoptableThread([thread("t1")], none, anchor, "What does this mean?"),
		).toBe("t1");
	});

	it("matches the quote as the server stores it, trimmed", () => {
		expect(
			adoptableThread(
				[thread("t1")],
				none,
				{ ...anchor, quote: "  the quoted passage\n" },
				"What does this mean?",
			),
		).toBe("t1");
	});

	it("ignores threads that existed when the panel opened", () => {
		expect(
			adoptableThread(
				[thread("old"), thread("t1")],
				new Set(["old"]),
				anchor,
				"What does this mean?",
			),
		).toBe("t1");
		expect(
			adoptableThread(
				[thread("old")],
				new Set(["old"]),
				anchor,
				"What does this mean?",
			),
		).toBeNull();
	});

	it("ignores a different anchor, quote, or first message", () => {
		const text = "What does this mean?";
		expect(
			adoptableThread(
				[thread("t1", { anchorMessageId: "a2" })],
				none,
				anchor,
				text,
			),
		).toBeNull();
		expect(
			adoptableThread(
				[thread("t1", { anchorQuote: "another" })],
				none,
				anchor,
				text,
			),
		).toBeNull();
		expect(
			adoptableThread(
				[thread("t1", { firstUserText: "Other" })],
				none,
				anchor,
				text,
			),
		).toBeNull();
		expect(
			adoptableThread(
				[thread("t1", { firstUserText: null })],
				none,
				anchor,
				text,
			),
		).toBeNull();
		expect(
			adoptableThread(
				[
					thread("t1", { anchorQuote: "another" }),
					thread("t2"),
					thread("t3", { firstUserText: "Other" }),
				],
				none,
				anchor,
				text,
			),
		).toBe("t2");
	});

	it("adopts nothing when several threads match", () => {
		expect(
			adoptableThread(
				[thread("t1"), thread("t2")],
				none,
				anchor,
				"What does this mean?",
			),
		).toBeNull();
	});

	it("adopts nothing from no threads", () => {
		expect(
			adoptableThread([], none, anchor, "What does this mean?"),
		).toBeNull();
	});
});

describe("isNewThreadCandidate", () => {
	it("needs a thread not known at open with the panel's anchor and quote", () => {
		expect(isNewThreadCandidate(thread("t1"), none, anchor)).toBe(true);
		expect(isNewThreadCandidate(thread("t1"), new Set(["t1"]), anchor)).toBe(
			false,
		);
		expect(
			isNewThreadCandidate(
				thread("t1", { anchorMessageId: "a2" }),
				none,
				anchor,
			),
		).toBe(false);
	});
});
