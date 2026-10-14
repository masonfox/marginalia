import { describe, expect, it } from "vitest";
import { readToolDetails, writeToolDetails } from "./tool-details";

const stub = () => {
	const data = new Map<string, string>();
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
	};
};

describe("tool details preference", () => {
	it("defaults to off and round-trips", () => {
		const s = stub();
		expect(readToolDetails(s)).toBe(false);
		writeToolDetails(true, s);
		expect(readToolDetails(s)).toBe(true);
		writeToolDetails(false, s);
		expect(readToolDetails(s)).toBe(false);
	});

	it("is off when storage throws", () => {
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
		expect(readToolDetails(bad)).toBe(false);
		expect(() => writeToolDetails(true, bad)).not.toThrow();
	});
});
