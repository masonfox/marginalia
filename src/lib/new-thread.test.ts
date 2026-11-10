import { describe, expect, it } from "vitest";
import { adoptableThread, isNewThreadCandidate } from "./new-thread";
import { attachmentKey, passageContextPart } from "./passage-ref";

const noAttachment = attachmentKey([]);
const passageKey = (start: number) =>
	attachmentKey([
		passageContextPart({
			locator: "3f9a1c07b2de:v1:12.47",
			range: { start, end: start + 10 },
			editionId: "ed1",
			bookTitle: "A Book",
			sectionTitle: null,
			text: "a passage",
		}),
	]);
const anchor = { anchorMessageId: "a1", quote: "the quoted passage" };
const thread = (
	id: string,
	over: Partial<{
		anchorMessageId: string;
		anchorQuote: string;
		firstUserText: string | null;
		firstUserAttachmentKey: string | null;
	}> = {},
) => ({
	id,
	anchorMessageId: "a1",
	anchorQuote: "the quoted passage",
	firstUserText: "What does this mean?",
	firstUserAttachmentKey: noAttachment,
	...over,
});
const none = new Set<string>();

describe("adoptableThread", () => {
	it("adopts the one new thread with the same anchor, quote, and first message", () => {
		expect(
			adoptableThread(
				[thread("t1")],
				none,
				anchor,
				"What does this mean?",
				noAttachment,
			),
		).toBe("t1");
	});

	it("matches the quote as the server stores it, trimmed", () => {
		expect(
			adoptableThread(
				[thread("t1")],
				none,
				{ ...anchor, quote: "  the quoted passage\n" },
				"What does this mean?",
				noAttachment,
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
				noAttachment,
			),
		).toBe("t1");
		expect(
			adoptableThread(
				[thread("old")],
				new Set(["old"]),
				anchor,
				"What does this mean?",
				noAttachment,
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
				noAttachment,
			),
		).toBeNull();
		expect(
			adoptableThread(
				[thread("t1", { anchorQuote: "another" })],
				none,
				anchor,
				text,
				noAttachment,
			),
		).toBeNull();
		expect(
			adoptableThread(
				[thread("t1", { firstUserText: "Other" })],
				none,
				anchor,
				text,
				noAttachment,
			),
		).toBeNull();
		expect(
			adoptableThread(
				[thread("t1", { firstUserText: null })],
				none,
				anchor,
				text,
				noAttachment,
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
				noAttachment,
			),
		).toBe("t2");
	});

	it("ignores a thread whose first message has the same text but another attachment", () => {
		const text = "What does this mean?";
		const other = thread("t1", { firstUserAttachmentKey: passageKey(0) });
		expect(
			adoptableThread([other], none, anchor, text, noAttachment),
		).toBeNull();
		expect(
			adoptableThread([other], none, anchor, text, passageKey(20)),
		).toBeNull();
		expect(
			adoptableThread(
				[thread("t1", { firstUserAttachmentKey: null })],
				none,
				anchor,
				text,
				noAttachment,
			),
		).toBeNull();
	});

	it("adopts the one thread whose first message has the retried attachment", () => {
		const text = "What does this mean?";
		const threads = [
			thread("t1", { firstUserAttachmentKey: passageKey(0) }),
			thread("t2", { firstUserAttachmentKey: passageKey(20) }),
			thread("t3"),
		];
		expect(adoptableThread(threads, none, anchor, text, passageKey(20))).toBe(
			"t2",
		);
		expect(adoptableThread(threads, none, anchor, text, passageKey(0))).toBe(
			"t1",
		);
		expect(adoptableThread(threads, none, anchor, text, noAttachment)).toBe(
			"t3",
		);
	});

	it("adopts nothing when several threads match", () => {
		expect(
			adoptableThread(
				[thread("t1"), thread("t2")],
				none,
				anchor,
				"What does this mean?",
				noAttachment,
			),
		).toBeNull();
	});

	it("adopts nothing from no threads", () => {
		expect(
			adoptableThread([], none, anchor, "What does this mean?", noAttachment),
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
