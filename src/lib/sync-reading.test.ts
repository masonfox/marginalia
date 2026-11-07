import { describe, expect, it } from "vitest";
import { movedBackText, readingText } from "./sync-reading";

describe("readingText", () => {
	it("words each kind of reading", () => {
		expect(readingText({ state: "reading", fraction: 0.42 })).toBe("42%");
		expect(readingText({ state: "reading", fraction: 0.29 })).toBe("29%");
		expect(readingText({ state: "reading", fraction: 0.999 })).toBe("99%");
		expect(
			readingText({
				state: "reading",
				fraction: 0.4,
				pages: { current: 120, total: 300 },
			}),
		).toBe("p. 120 of 300");
		expect(
			readingText({ state: "reading", locator: { kind: "spine", index: 6 } }),
		).toBe("section 7");
		expect(readingText({ state: "finished", fraction: 1 })).toBe("finished");
		expect(readingText({ state: "not-started" })).toBe("not started");
		expect(readingText({ state: "reading" })).toBe("reading");
	});
});

describe("movedBackText", () => {
	it("names the previous unit, or finished", () => {
		expect(movedBackText("Chapter 14")).toBe("Moved back from Chapter 14");
		expect(movedBackText("Finished")).toBe("Moved back from finished");
	});
});
