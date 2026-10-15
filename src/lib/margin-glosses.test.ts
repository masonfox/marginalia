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
	});
});
