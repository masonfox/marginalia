import { describe, expect, it } from "vitest";
import {
	type ProgressReading,
	readingFingerprint,
	type StoredReading,
} from ".";

describe("readingFingerprint", () => {
	const base = {
		state: "reading" as const,
		fraction: 0.42,
		pages: { current: 120, total: 300 },
		locator: { kind: "spine" as const, index: 9, offset: 2 },
	};

	it("ignores observedAt", () => {
		const earlier: ProgressReading = { ...base, observedAt: new Date(0) };
		const later: ProgressReading = { ...base, observedAt: new Date() };
		const stored: StoredReading = {
			...base,
			observedAt: "2026-11-07T00:00:00Z",
		};
		expect(readingFingerprint(earlier)).toBe(readingFingerprint(later));
		expect(readingFingerprint(stored)).toBe(readingFingerprint(base));
		expect(readingFingerprint(base)).toBe(readingFingerprint(later));
	});

	it("changes with a small fraction change", () => {
		expect(readingFingerprint({ ...base, fraction: 0.43 })).not.toBe(
			readingFingerprint(base),
		);
	});

	it("ignores noise below 4 decimals", () => {
		expect(readingFingerprint({ ...base, fraction: 0.42000001 })).toBe(
			readingFingerprint(base),
		);
		expect(readingFingerprint({ ...base, fraction: 0.420049 })).toBe(
			readingFingerprint(base),
		);
	});

	it("does not depend on key order", () => {
		const reordered = {
			locator: { offset: 2, index: 9, kind: "spine" as const },
			pages: { total: 300, current: 120 },
			fraction: 0.42,
			state: "reading" as const,
		};
		expect(readingFingerprint(reordered)).toBe(readingFingerprint(base));
	});

	it("changes with state, pages and locator", () => {
		const fp = readingFingerprint(base);
		expect(readingFingerprint({ ...base, state: "finished" })).not.toBe(fp);
		expect(
			readingFingerprint({ ...base, pages: { current: 121, total: 300 } }),
		).not.toBe(fp);
		expect(
			readingFingerprint({ ...base, locator: { kind: "spine", index: 9 } }),
		).not.toBe(fp);
		expect(readingFingerprint({ state: "reading" })).not.toBe(
			readingFingerprint({ state: "reading", fraction: 0 }),
		);
	});
});
