import { describe, expect, it } from "vitest";
import { blockedReason } from "./send-button";

describe("blockedReason", () => {
	it("asks for a message first, then waits for a passage check", () => {
		expect(blockedReason({ draft: "", checking: false })).toBe(
			"Type a message",
		);
		expect(blockedReason({ draft: " \n\t", checking: true })).toBe(
			"Type a message",
		);
		expect(blockedReason({ draft: "Why?", checking: true })).toBe(
			"Checking passage…",
		);
		expect(blockedReason({ draft: "Why?", checking: false })).toBeNull();
	});
});
