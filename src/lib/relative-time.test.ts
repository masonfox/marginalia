import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const now = new Date("2026-11-05T12:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe("relativeTime", () => {
	it("says just now under a minute", () => {
		expect(relativeTime(ago(30), now)).toBe("just now");
	});

	it("uses the largest whole unit", () => {
		expect(relativeTime(ago(5 * 60), now)).toMatch(/5 minutes ago/);
		expect(relativeTime(ago(3 * 3600), now)).toMatch(/3 hours ago/);
		expect(relativeTime(ago(24 * 3600), now)).toMatch(/yesterday/);
		expect(relativeTime(ago(3 * 7 * 24 * 3600), now)).toMatch(/3 weeks ago/);
		expect(relativeTime(ago(400 * 24 * 3600), now)).toMatch(/last year/);
	});
});
