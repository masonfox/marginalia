import { describe, expect, it } from "vitest";
import {
	SHELF_STATUS_CLASS,
	SHELF_STATUS_LABEL,
	SHELF_STATUSES,
	shelfCountLabel,
	shelfFilterOptions,
} from "./shelf-status";

describe("status badge", () => {
	it("labels every status, and none of them Ready", () => {
		expect(SHELF_STATUSES.map((s) => SHELF_STATUS_LABEL[s])).toEqual([
			"Processing",
			"Failed",
			"Unavailable",
			"Not started",
			"Reading",
			"Finished",
		]);
		expect(Object.values(SHELF_STATUS_LABEL)).not.toContain("Ready");
	});

	it("gives every status its own color", () => {
		for (const status of SHELF_STATUSES) {
			expect(SHELF_STATUS_CLASS[status]).toContain(`text-status-${status}`);
		}
		expect(new Set(Object.values(SHELF_STATUS_CLASS)).size).toBe(
			SHELF_STATUSES.length,
		);
	});
});

describe("status filter", () => {
	const labels = (...args: Parameters<typeof shelfFilterOptions>) =>
		shelfFilterOptions(...args).map((o) => o.label);

	it("offers Needs attention only while something needs it", () => {
		expect(labels(0, undefined)).toEqual([
			"All",
			"Not started",
			"Reading",
			"Finished",
		]);
		expect(labels(2, undefined)).toContain("Needs attention");
	});

	it("keeps Needs attention while it is selected", () => {
		expect(labels(0, "attention")).toContain("Needs attention");
	});

	it("maps All to no filter", () => {
		expect(shelfFilterOptions(0, undefined)[0]).toEqual({
			value: undefined,
			label: "All",
		});
	});
});

describe("count", () => {
	it("shows the total, or matches out of the total while narrowed", () => {
		expect(shelfCountLabel(1, 1, false)).toBe("1 book");
		expect(shelfCountLabel(12, 12, false)).toBe("12 books");
		expect(shelfCountLabel(12, 3, true)).toBe("3 of 12 books");
		expect(shelfCountLabel(1, 0, true)).toBe("0 of 1 book");
	});
});
