import { describe, expect, it } from "vitest";
import { readMarginGlosses, writeMarginGlosses } from "./margin-glosses";

const stub = () => {
	const data = new Map<string, string>();
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
	};
};

describe("margin glosses preference", () => {
	it("defaults to on and round-trips", () => {
		const s = stub();
		expect(readMarginGlosses(s)).toBe(true);
		writeMarginGlosses(false, s);
		expect(readMarginGlosses(s)).toBe(false);
		writeMarginGlosses(true, s);
		expect(readMarginGlosses(s)).toBe(true);
	});

	it("is on when storage throws", () => {
		const bad = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
			removeItem: () => {
				throw new Error("denied");
			},
		};
		expect(readMarginGlosses(bad)).toBe(true);
		expect(() => writeMarginGlosses(false, bad)).not.toThrow();
		// The choice still takes effect for this page.
		expect(readMarginGlosses(bad)).toBe(false);
		writeMarginGlosses(true, bad);
		expect(readMarginGlosses(bad)).toBe(true);
		// Storage keeps it again once a write succeeds.
		const s = stub();
		writeMarginGlosses(false, s);
		expect(readMarginGlosses(s)).toBe(false);
		writeMarginGlosses(true, s);
	});

	it("takes effect without storage", () => {
		writeMarginGlosses(false, undefined);
		expect(readMarginGlosses(undefined)).toBe(false);
		writeMarginGlosses(true, undefined);
		expect(readMarginGlosses(undefined)).toBe(true);
	});
});
