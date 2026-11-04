import { describe, expect, it } from "vitest";
import {
	type PollableShelfPage,
	SHELF_STATUS_CLASS,
	SHELF_STATUS_LABEL,
	SHELF_STATUSES,
	type ShelfStatus,
	shelfCountLabel,
	shelfFilterOptions,
	shouldPollShelf,
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

describe("shouldPollShelf", () => {
	const page = (
		processing: number | null,
		...statuses: ShelfStatus[]
	): PollableShelfPage => ({
		processing,
		items: statuses.map((status) => ({ status })),
	});

	it("polls while the first page counts a book as processing", () => {
		expect(shouldPollShelf([page(1, "reading")])).toBe(true);
	});

	it("polls while a loaded book shows Processing after the count reaches 0", () => {
		expect(shouldPollShelf([page(0, "processing")])).toBe(true);
	});

	it("polls while a book on a later page shows Processing", () => {
		expect(
			shouldPollShelf([
				page(0, "reading", "finished"),
				page(null, "not-started", "processing"),
			]),
		).toBe(true);
	});

	it("stops when nothing is processing", () => {
		expect(
			shouldPollShelf([
				page(0, "reading", "failed"),
				page(null, "finished", "unavailable"),
			]),
		).toBe(false);
	});

	it("ignores the null counts of later pages", () => {
		expect(shouldPollShelf([page(0), page(null)])).toBe(false);
	});

	it("does not poll before any page loads", () => {
		expect(shouldPollShelf(undefined)).toBe(false);
		expect(shouldPollShelf([])).toBe(false);
	});
});
