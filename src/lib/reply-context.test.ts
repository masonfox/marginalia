import { describe, expect, it } from "vitest";
import {
	projectReplyContext,
	replyContextOf,
	replyContextPart,
	replyContextSchema,
} from "./reply-context";

const messageId = "11111111-1111-4111-8111-111111111111";
describe("reply context", () => {
	it("trims boundaries and counts UTF-16 units", () => {
		expect(
			replyContextSchema.parse({ messageId, text: "  a\n b  " }).text,
		).toBe("a\n b");
		for (const text of ["x".repeat(2000), "??".repeat(1000)])
			expect(replyContextSchema.safeParse({ messageId, text }).success).toBe(
				true,
			);
		for (const text of [" ", "x".repeat(2001), "??".repeat(1001)])
			expect(replyContextSchema.safeParse({ messageId, text }).success).toBe(
				false,
			);
	});
	it("extracts snapshots and projects once without mutation", () => {
		const parts = [
			replyContextPart({ messageId, text: "[[cite example]]" }),
			{ type: "text", text: "Why?" },
		];
		const before = JSON.stringify(parts);
		expect(replyContextOf(parts)?.version).toBe(1);
		expect(projectReplyContext(parts)).toEqual(projectReplyContext(parts));
		expect(
			JSON.stringify(projectReplyContext(parts)).match(/\[\[cite example\]\]/g),
		).toHaveLength(1);
		expect(JSON.stringify(parts)).toBe(before);
		expect(replyContextOf([{ type: "text", text: "legacy" }])).toBeUndefined();
	});
});
