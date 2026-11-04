import { describe, expect, it } from "vitest";
import { uniqueById } from "./conversation-pages";

describe("uniqueById", () => {
	it("keeps the first occurrence of each id, in page order", () => {
		const pages = [
			{ items: [{ id: "a" }, { id: "b" }] },
			{ items: [{ id: "b" }, { id: "c" }] },
			{ items: [{ id: "a" }, { id: "d" }] },
		];
		expect(uniqueById(pages).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
	});

	it("returns nothing for no pages", () => {
		expect(uniqueById([])).toEqual([]);
	});
});
